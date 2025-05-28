<template>
  <div>
    <GisMap
      :center="[116.4, 39.9]" <!-- Initial map center: Beijing -->
      :zoom="5" <!-- Initial map zoom level -->
      :overlayLayersConfig="overlayLayersConfig"
      @selection="handleSelection" <!-- Listen for selection events from GisMap -->
    />
    <div v-if="currentSelectionDetails" class="selection-details">
      <h4>Selection Details (from Circle's Extent):</h4>
      <p>Extent (Lon/Lat): 
        SW: {{ currentSelectionDetails.lonLatExtent[0].toFixed(4) }}, {{ currentSelectionDetails.lonLatExtent[1].toFixed(4) }} | 
        NE: {{ currentSelectionDetails.lonLatExtent[2].toFixed(4) }}, {{ currentSelectionDetails.lonLatExtent[3].toFixed(4) }}
      </p>
      <p>Center (Map Projection): {{ currentSelectionDetails.center[0].toFixed(2) }}, {{ currentSelectionDetails.center[1].toFixed(2) }}</p>
      <p>Center (Lon/Lat): {{ currentSelectionDetails.lonLatCenter[0].toFixed(4) }}, {{ currentSelectionDetails.lonLatCenter[1].toFixed(4) }}</p>
      <p>Circle Area: {{ (currentSelectionDetails.area / 1000000).toFixed(2) }} km²</p> 
      <!-- Area is provided in m², converted to km² for display -->
    </div>
    <div v-else class="selection-prompt">
      <p>No selection made. Click "Start Selection" in the map toolbar and draw a circle on the map.</p>
    </div>
  </div>
</template>

<script setup>
import GisMap from '@/components/GisMap.vue';
import { ref, onMounted } from 'vue';
// OpenLayers style imports for defining layer styles
import { Style, Circle as CircleStyle, Fill, Stroke } from 'ol/style';
import { transform } from 'ol/proj'; // For transforming coordinates (e.g., selection center)

// Base style for the "Beijing Points" layer, reused in its style function
const beijingLayerBaseStyle = new Style({
  image: new CircleStyle({
    radius: 7,
    fill: new Fill({ color: 'blue' }),
    stroke: new Stroke({ color: 'white', width: 2 }),
  }),
});

// Reactive array holding configurations for overlay layers passed to GisMap component
const overlayLayersConfig = ref([
  {
    id: 'beijing_layer',
    name: 'Beijing Points (Static & Filterable)',
    geoJson: { // Direct GeoJSON data for this layer
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [116.4, 39.9] },
          properties: { name: 'Beijing Center', type: 'City Capital' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [116.41, 39.91] },
          properties: { name: 'Near Beijing Center', type: 'Suburb' },
        },
        { 
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [100.0, 35.0] }, // Point for filter testing
          properties: { name: 'Far Point', type: 'Remote' },
        }
      ],
    },
    visible: true, // Initially visible
    // Style function: Hides features if '_hidden_by_filter' property is true
    style: function(feature) {
      if (feature.get('_hidden_by_filter')) {
        return null; // Do not render the feature
      }
      return beijingLayerBaseStyle; // Apply base style otherwise
    },
    // Popup function: Returns HTML content for a feature's popup
    popup: (feature) => `<strong>${feature.get('name')}</strong><br>Type: ${feature.get('type')}`,
  },
  {
    id: 'shanghai_layer',
    name: 'Shanghai Point (Static, Initially Hidden)',
    geoJson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [121.47, 31.23] },
          properties: { name: 'Shanghai Center', population: '24 million' },
        },
      ],
    },
    visible: false, // Initially hidden
    style: new Style({ // Direct style object as this layer is not filterable by current logic
      image: new CircleStyle({
        radius: 8,
        fill: new Fill({ color: 'red' }),
        stroke: new Stroke({ color: 'black', width: 1 }),
      }),
    }),
    popup: (feature) => `City: ${feature.get('name')}<br>Population: ${feature.get('population')}`,
  },
  {
    id: 'dummy_line_layer',
    name: 'Sample Line (Static)',
    geoJson: {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [ [110, 35], [115, 38], [120, 35] ]
                },
                properties: { name: 'A Sample Line', length: 'approx 1000km' }
            }
        ]
    },
    visible: true,
    style: new Style({ // Direct style object
      stroke: new Stroke({
        color: 'green',
        width: 3,
      }),
    }),
    popup: (feature) => `Line: ${feature.get('name')}<br>Length: ${feature.get('length')}`,
  }
]);

// Reactive ref to store details of the current map selection
const currentSelectionDetails = ref(null);

// Lifecycle hook: Fetches additional GeoJSON data when the component is mounted
onMounted(async () => {
  try {
    const response = await fetch('/data/placenames.geojson'); // Assumes file is in public/data
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const fetchedGeoJsonData = await response.json();

    // Configuration for the dynamically fetched "Place Names" layer
    const placenamesLayerConfig = {
      id: 'placenames_layer_dynamic',
      name: 'Place Names (Dynamic)',
      geoJson: fetchedGeoJsonData, // Data used by GisMap to create VectorSource
      visible: true,
      style: new Style({ // Style for these dynamic points
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: 'rgba(255, 165, 0, 0.7)' }), // Orange, semi-transparent
          stroke: new Stroke({ color: 'white', width: 1.5 }),
        }),
      }),
      popup: (feature) => { // Popup function for dynamic points
        const name = feature.get('name') || 'Unnamed place';
        return `<strong>${name}</strong>`;
      }
    };
    overlayLayersConfig.value.push(placenamesLayerConfig); // Add to the list of layers for GisMap
    console.log('Place Names layer (dynamic) fetched and added to config.');
  } catch (error) {
    console.error('Error fetching or processing placenames.geojson for dynamic layer:', error);
  }
});

// Handler for the 'selection' event emitted by GisMap
function handleSelection(selectionData) {
  if (selectionData) {
    // Transform center from map projection (EPSG:3857) to Lon/Lat (EPSG:4326) for display
    const lonLatCenter = transform(selectionData.center, 'EPSG:3857', 'EPSG:4326');
    currentSelectionDetails.value = {
      ...selectionData,
      lonLatCenter: lonLatCenter, // Add transformed center to the details
    };
    console.log('Selection received in parent:', currentSelectionDetails.value);
  } else {
    currentSelectionDetails.value = null; // Clear details if selection is cleared
    console.log('Selection cleared in parent.');
  }
}

</script>

<style scoped>
.selection-details, .selection-prompt {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background-color: #f9f9f9;
}
.selection-prompt p {
  margin: 0;
  color: #555;
}
/* Ensure the root div of this view component allows GisMap to take full space if needed */
div {
  width: 100%;
  height: 100%; 
}
</style>
