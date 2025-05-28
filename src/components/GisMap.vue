<template>
  <div class="gis-map-wrapper">
    <div class="toolbar">
      <div>
        <span>Base Layer: </span>
        <button
          v-for="(layerConfig, id) in baseLayerSources"
          :key="id"
          @click="switchBaseLayer(id)"
          :class="{ active: currentBaseLayerId === id }"
        >
          {{ layerConfig.name }}
        </button>
      </div>
      <div class="overlay-controls">
        <span>Overlays: </span>
        <div v-for="config in props.overlayLayersConfig" :key="config.id" class="overlay-item">
          <label>
            <input 
              type="checkbox" 
              :checked="isOverlayLayerVisible(config.id)" 
              @change="toggleOverlayLayer(config.id, $event.target.checked)"
            >
            {{ config.name }}
          </label>
        </div>
      </div>
      <div class="selection-toolbar">
        <span>Selection: </span>
        <button @click="toggleSelectionMode">{{ selecting ? 'Cancel Drawing' : 'Start Selection' }}</button>
        <button @click="clearDrawingAndSelection" :disabled="!drawSource || drawSource.getFeatures().length === 0">Clear Selection</button>
      </div>
    </div>
    <div ref="mapContainer" class="map-container"></div>
    <div ref="popupContainer" class_alias="ol-popup"> <!-- ol-popup class for OpenLayers default styling -->
      <a href="#" ref="popupCloser" class_alias="ol-popup-closer" @click.prevent="closePopup"></a>
      <div id="popup-content"></div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { Logger } from '@/utils/logger';
import { GISLoadError } from '@/utils/errors';

// OpenLayers imports
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import GeoJSON from 'ol/format/GeoJSON';
import Overlay from 'ol/Overlay'; // For popups
import Draw from 'ol/interaction/Draw'; // For drawing selections
import { getArea } from 'ol/sphere'; // For geodesic area calculation
import { getCenter, containsCoordinate } from 'ol/extent'; // For extent operations, containsCoordinate for filtering
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj'; // For coordinate transformations
import 'ol/ol.css'; // OpenLayers default styles

const props = defineProps({
  center: { type: Array, default: () => [0, 0] }, // Expected as [longitude, latitude]
  zoom: { type: Number, default: 2 },
  overlayLayersConfig: { type: Array, default: () => [] }, // Configuration for overlay layers
});

const emit = defineEmits(['selection']); // Emits selection data

const mapContainer = ref(null);
const popupContainer = ref(null); // Ref for the popup DOM element
const popupCloser = ref(null); // Ref for the popup closer button
let olMap = null; // Holds the OpenLayers Map instance
let popupOverlay = null; // Holds the OpenLayers Overlay instance for popups

// Base Layer Configurations
const baseLayerSources = {
  osm: { name: 'OpenStreetMap', source: new OSM() },
  esriWorldImagery: {
    name: 'ESRI World Imagery',
    source: new XYZ({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attributions: 'Tiles © Esri', maxZoom: 19,
    }),
  },
};
const mapBaseLayers = ref([]); // Stores initialized OpenLayers TileLayer instances for base maps
const currentBaseLayerId = ref('osm'); // ID of the currently active base layer

// Overlay Layer Management
const mapOverlayLayers = ref(new Map()); // Stores OpenLayers VectorLayer instances by config.id
const overlayVisibilityState = ref(new Map()); // Stores visibility state (true/false) by config.id

// Drawing/Selection & Filtering
const drawSource = new VectorSource(); // Source for drawing selection shapes
const drawLayer = new VectorLayer({ // Layer to display drawn selection shapes
  source: drawSource,
  style: { // Default style for the drawn selection shape (e.g., a circle's extent)
    'stroke-color': 'rgba(0, 0, 255, 0.7)',
    'stroke-width': 3,
    'fill-color': 'rgba(0, 0, 255, 0.1)',
  },
});
let drawInteraction = null; // Holds the OpenLayers Draw interaction instance
const selecting = ref(false); // True if selection drawing mode is active
const filteredLayerId = ref(null); // ID of the overlay layer currently being filtered by selection


// Switches the visible base layer on the map
const switchBaseLayer = (layerIdToActivate) => {
  mapBaseLayers.value.forEach(layer => layer.setVisible(layer.get('layerId') === layerIdToActivate));
  currentBaseLayerId.value = layerIdToActivate;
};

// Checks if an overlay layer is currently set to be visible
const isOverlayLayerVisible = (layerId) => overlayVisibilityState.value.get(layerId) !== false;

// Toggles the visibility of an overlay layer
const toggleOverlayLayer = (layerId, isVisible) => {
  const layer = mapOverlayLayers.value.get(layerId);
  if (layer) {
    layer.setVisible(isVisible);
    overlayVisibilityState.value.set(layerId, isVisible); // Persist user's visibility choice
  }
};

// Loads or reloads overlay layers based on props.overlayLayersConfig
const loadOverlayLayers = async () => {
  if (!olMap) return;
  // Clear existing overlay layers from map and internal store
  mapOverlayLayers.value.forEach(layer => olMap.removeLayer(layer));
  mapOverlayLayers.value.clear();
  // Note: overlayVisibilityState is intentionally not cleared to maintain user preferences across reloads.

  for (const config of props.overlayLayersConfig) {
    try {
      const vectorSource = new VectorSource();
      // Load features from direct GeoJSON data or a URL
      if (config.geoJson) {
        const features = new GeoJSON().readFeatures(config.geoJson, { featureProjection: olMap.getView().getProjection() });
        vectorSource.addFeatures(features);
      } else if (config.dataUrl) {
        const response = await fetch(config.dataUrl);
        if (!response.ok) throw new Error(`Fetch error: ${response.status}`);
        const geoJsonData = await response.json();
        const features = new GeoJSON().readFeatures(geoJsonData, { featureProjection: olMap.getView().getProjection() });
        vectorSource.addFeatures(features);
      }
      
      const vectorLayer = new VectorLayer({
        source: vectorSource, 
        style: config.style, // Style can be an OpenLayers Style object or a style function
        visible: overlayVisibilityState.value.get(config.id) !== false, // Default to visible if not set
      });
      vectorLayer.set('layerId', config.id); // Custom property for identification
      vectorLayer.set('popupFunction', config.popup); // Store popup function for click events
      
      olMap.addLayer(vectorLayer);
      mapOverlayLayers.value.set(config.id, vectorLayer);
      // Initialize visibility state if it's not already set (e.g., first load)
      if (overlayVisibilityState.value.get(config.id) === undefined) {
        overlayVisibilityState.value.set(config.id, config.visible !== false);
      }
    } catch (error) { Logger.error(`Error loading overlay layer "${config.name}":`, error); }
  }
};

// Closes the popup overlay
const closePopup = () => {
  if (popupOverlay) popupOverlay.setPosition(undefined);
  if (popupCloser.value) popupCloser.value.blur(); // Remove focus from closer
  return false; // Prevent default if called from an anchor tag
};

// --- Filtering Logic ---
// Applies a filter to the specified layer based on the selection extent.
// Features outside the extent will have a '_hidden_by_filter' property set to true.
const applyFilterToLayer = (layerId, selectionExtent) => {
  const layer = mapOverlayLayers.value.get(layerId);
  if (!layer) { Logger.warn(`Filter target layer ${layerId} not found.`); return; }
  const source = layer.getSource();
  if (!source || typeof source.getFeatures !== 'function') { Logger.warn(`Source for layer ${layerId} is not a VectorSource.`); return; }

  source.getFeatures().forEach(feature => {
    const geometry = feature.getGeometry();
    // Check if the feature's geometry (or its extent) intersects the selection extent
    const featureIsInside = geometry ? geometry.intersectsExtent(selectionExtent) : false;
    feature.set('_hidden_by_filter', !featureIsInside);
  });
  source.changed(); // Trigger layer re-render to apply style changes based on '_hidden_by_filter'
  filteredLayerId.value = layerId;
  Logger.info(`Filter applied to layer: ${layerId}`);
};

// Clears any active filter from the specified layer.
const clearFilterFromLayer = (layerId) => {
  if (!layerId) return;
  const layer = mapOverlayLayers.value.get(layerId);
  if (!layer) { Logger.warn(`Filter clear target layer ${layerId} not found.`); return; }
  const source = layer.getSource();
  if (!source || typeof source.getFeatures !== 'function') { Logger.warn(`Source for layer ${layerId} for clearing filter is not a VectorSource.`); return; }
  
  source.getFeatures().forEach(feature => {
    feature.set('_hidden_by_filter', false); // Reset filter property
  });
  source.changed(); // Trigger re-render
  Logger.info(`Filter cleared from layer: ${layerId}`);
};


// --- Drawing and Selection Logic ---
// Starts the drawing interaction on the map.
const startDrawing = () => {
  if (!olMap) return;
  drawSource.clear(); // Clear any previous selection drawing
  // Clear any existing filter before starting a new selection
  if (filteredLayerId.value) {
    clearFilterFromLayer(filteredLayerId.value);
    filteredLayerId.value = null;
  }
  if (drawInteraction) olMap.removeInteraction(drawInteraction); // Remove old interaction if any

  drawInteraction = new Draw({
    source: drawSource,
    type: 'Circle', // Drawing type is Circle; its extent will define the selection area
  });

  olMap.addInteraction(drawInteraction);
  selecting.value = true; // Update drawing state

  drawInteraction.on('drawend', (event) => {
    const feature = event.feature;
    const geometry = feature.getGeometry();
    const extent = geometry.getExtent(); // Bounding box of the drawn circle
    const mapProjection = olMap.getView().getProjection().getCode();
    
    // Transform extent to Lon/Lat for emission
    const lonLatExtent = transformExtent(extent, mapProjection, 'EPSG:4326');
    
    // Calculate geodesic area of the drawn circle for more accuracy
    const geomForArea = geometry.clone().transform(mapProjection, 'EPSG:4326'); 
    const area = getArea(geomForArea); // Area in square meters

    emit('selection', {
      extent: extent, // Raw extent in map projection (e.g., EPSG:3857)
      lonLatExtent: lonLatExtent, // Extent in EPSG:4326
      center: getCenter(extent), // Center in map projection
      area: area, // Geodesic area of the drawn circle in m^2
    });

    // Apply filter to the first configured overlay layer (if any)
    if (props.overlayLayersConfig.length > 0) {
      const targetLayerId = props.overlayLayersConfig[0].id;
      applyFilterToLayer(targetLayerId, extent);
    }
    
    stopDrawing(false); // Keep the drawn shape on map, but deactivate interaction
  });
};

// Stops the drawing interaction.
const stopDrawing = (clearDrawingLayer = true, clearCurrentFilter = true) => {
  if (olMap && drawInteraction) {
    olMap.removeInteraction(drawInteraction);
    drawInteraction = null;
  }
  if (clearDrawingLayer) {
    drawSource.clear(); // Remove drawn shape
    emit('selection', null); // Clear selection details in parent
    if (clearCurrentFilter && filteredLayerId.value) {
      clearFilterFromLayer(filteredLayerId.value);
      filteredLayerId.value = null;
    }
  }
  selecting.value = false; // Update drawing state
};

// Toggles the selection drawing mode.
const toggleSelectionMode = () => {
  if (selecting.value) {
    stopDrawing(true, true); // If currently drawing, stop and clear everything
  } else {
    startDrawing(); // Otherwise, start drawing
  }
};

// Clears the current drawing and any active filter.
const clearDrawingAndSelection = () => {
  drawSource.clear(); // Clear drawn shape
  emit('selection', null); // Clear selection details
  if (filteredLayerId.value) { // If a filter is active, clear it
    clearFilterFromLayer(filteredLayerId.value);
    filteredLayerId.value = null;
  }
  if (selecting.value) { // If was in drawing mode, ensure it's stopped
      stopDrawing(true, false); // Drawing layer is already cleared, filter is cleared, just ensure mode is off
  }
};


onMounted(async () => {
  if (!mapContainer.value || !popupContainer.value) { // Ensure popup container is also ready
    Logger.error('Map or Popup container ref is not available.');
    throw new GISLoadError('Container not found for OpenLayers map initialization.');
  }
  try {
    const initialBaseLayers = [];
    for (const id in baseLayerSources) {
      const layerConfig = baseLayerSources[id];
      const olTileLayer = new TileLayer({ source: layerConfig.source, visible: id === currentBaseLayerId.value });
      olTileLayer.set('layerId', id);
      initialBaseLayers.push(olTileLayer);
      mapBaseLayers.value.push(olTileLayer);
    }

    olMap = new Map({
      target: mapContainer.value,
      layers: [...initialBaseLayers, drawLayer], // Add drawLayer to the map on init
      view: new View({ center: fromLonLat(props.center), zoom: props.zoom }),
    });

    // Initialize popup overlay
    popupOverlay = new Overlay({ 
      element: popupContainer.value, 
      autoPan: { animation: { duration: 250 } } 
    });
    olMap.addOverlay(popupOverlay);
    
    await loadOverlayLayers(); // Load initial overlay layers
    Logger.info('OpenLayers map initialized.');

    // Map click listener for popups
    olMap.on('singleclick', (evt) => {
      if (selecting.value) return; // Don't show popups while drawing
      
      let contentSet = false;
      olMap.forEachFeatureAtPixel(evt.pixel, (feature, layerInstance) => {
        if (contentSet || layerInstance === drawLayer) return; // Ignore clicks on drawLayer features for popups
        
        const popupFunction = layerInstance.get('popupFunction');
        if (typeof popupFunction === 'function') {
          const content = popupFunction(feature);
          if (content) { // Ensure content is not null/empty before showing popup
            document.getElementById('popup-content').innerHTML = content;
            popupOverlay.setPosition(evt.coordinate);
            contentSet = true;
          }
        }
      });
      if (!contentSet) closePopup(); // If no feature with popup found, close any open popup
    });

    // Watchers for prop changes
    watch(() => props.center, (newCenter) => olMap?.getView().animate({ center: fromLonLat(newCenter), duration: 300 }));
    watch(() => props.zoom, (newZoom) => olMap?.getView().animate({ zoom: newZoom, duration: 300 }));
    watch(() => props.overlayLayersConfig, loadOverlayLayers, { deep: true }); // Reload overlays if config changes

  } catch (err) {
    Logger.error('OpenLayers map initialization failed', err);
    throw new GISLoadError('OpenLayers map initialization failed: ' + err.message);
  }
});

onBeforeUnmount(() => {
  if (olMap) {
    stopDrawing(); // Clean up draw interaction if active
    olMap.setTarget(null); // Detach map from DOM
    olMap = null;
    // Clear reactive refs
    mapBaseLayers.value = [];
    mapOverlayLayers.value.clear();
    overlayVisibilityState.value.clear();
    Logger.info('OpenLayers map disposed');
  }
});

</script>

<style scoped>
.gis-map-wrapper {
  position: relative;
  width: 100%;
  height: 500px; /* Example height, adjust as needed */
}
.map-container {
  width: 100%;
  height: 100%;
}
.toolbar {
  padding: 8px;
  display: flex;
  flex-direction: column; /* Stack control groups vertically */
  gap: 8px;
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1000; 
  background-color: rgba(255, 255, 255, 0.8);
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}
.toolbar > div { /* Each group of controls (base, overlay, selection) */
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap; /* Allow buttons to wrap if toolbar is narrow */
}
.toolbar span { /* Label for each group */
  font-weight: bold;
  margin-right: 5px;
}
.overlay-controls {
  flex-direction: column; /* Stack checkboxes vertically */
  align-items: flex-start;
}
.overlay-item label {
  display: flex;
  align-items: center;
  font-weight: normal;
  cursor: pointer;
}
.overlay-item input[type="checkbox"] {
  margin-right: 5px;
}
.selection-toolbar button {
  margin-left: 5px;
}
.toolbar button {
  background: #f0f0f0;
  color: #333;
  border: 1px solid #ccc;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
}
.toolbar button:hover {
  background-color: #e0e0e0;
}
.toolbar button.active { /* For active base layer button */
  background: #3a6edb;
  color: white;
  border-color: #3a6edb;
}
.toolbar button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
  opacity: 0.7;
}

/* OpenLayers Popup Styles - class_alias used in template to avoid conflicts */
[class_alias="ol-popup"] {
  position: absolute;
  background-color: white;
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
  padding: 15px;
  border-radius: 10px;
  border: 1px solid #cccccc;
  bottom: 12px;
  left: -50px; /* Will be adjusted by OpenLayers based on content */
  min-width: 180px;
  transform: translateX(-50%); /* Helps initially, but OL might override positioning */
}
[class_alias="ol-popup"]:after, [class_alias="ol-popup"]:before {
  top: 100%;
  border: solid transparent;
  content: " ";
  height: 0;
  width: 0;
  position: absolute;
  pointer-events: none;
}
[class_alias="ol-popup"]:after {
  border-top-color: white;
  border-width: 10px;
  left: 50%;
  margin-left: -10px;
}
[class_alias="ol-popup"]:before {
  border-top-color: #cccccc;
  border-width: 11px;
  left: 50%;
  margin-left: -11px;
}
[class_alias="ol-popup-closer"] {
  text-decoration: none;
  position: absolute;
  top: 2px;
  right: 8px;
  font-size: 1.5em;
  color: #333;
}
[class_alias="ol-popup-closer"]:after {
  content: "✖";
}
#popup-content {
  font-size: 0.9em;
}
</style>
