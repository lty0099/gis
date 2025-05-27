<template>
  <div class="gis-map-wrapper">
    <div class="toolbar">
      <button @click="toggleSelection">{{ selecting ? '关闭框选' : '开启框选' }}</button>
      <button @click="clearSelection" :disabled="!selectionActive">清除绘图</button>
    </div>
    <div ref="mapContainer" class="map-container"></div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
// import 'leaflet-draw'
import 'leaflet-draw/dist/leaflet.draw.js'
import 'leaflet-draw/dist/leaflet.draw.css'
import { Logger } from '@/utils/logger'
import { GISLoadError } from '@/utils/errors'

const props = defineProps({
  center: { type: Array, default: () => [0, 0] },
  zoom: { type: Number, default: 2 },
  // geoJsonData: { type: Object, default: null }, // Old prop
  layers: { type: Array, default: () => [] }, // New prop for multiple layers
})

const emit = defineEmits(['selection'])

const mapContainer = ref(null)
let map = null
let baseLayers = null // For base map tiles
let layersControl = null // To manage base and overlay layers
const activeGeoJsonLayers = new Map() // Stores L.GeoJSON instances by layer id
const rawGeoJsonDataMap = new Map() // Stores original GeoJSON data by layer id for filtering
let filteredLayerId = null // ID of the layer currently showing filtered data

// let currentGeoJsonLayer = null; // Replaced by activeGeoJsonLayers and filteredLayerId
// let rawGeoJsonData = null; // Replaced by rawGeoJsonDataMap

let drawLayer = null
let selecting = ref(false)
let selectionActive = ref(false) // 是否存在绘制区域

// Function to setup/update all overlay layers
const setupLayers = (newLayers) => {
  // Clear existing overlay layers from map and control
  activeGeoJsonLayers.forEach((layerInstance, id) => {
    map.removeLayer(layerInstance)
    if (layersControl) {
      layersControl.removeLayer(layerInstance)
    }
    rawGeoJsonDataMap.delete(id)
  })
  activeGeoJsonLayers.clear()
  filteredLayerId = null // Reset filtered layer

  const overlayLayersControlGroup = {}

  if (newLayers && newLayers.length > 0) {
    newLayers.forEach((layerConfig) => {
      if (!layerConfig || !layerConfig.id || !layerConfig.data) {
        Logger.warn('Invalid layer configuration:', layerConfig)
        return
      }

      rawGeoJsonDataMap.set(layerConfig.id, JSON.parse(JSON.stringify(layerConfig.data))) // Store deep copy

      const geoJsonLayer = L.geoJSON(layerConfig.data, layerConfig.options)
      activeGeoJsonLayers.set(layerConfig.id, geoJsonLayer)
      overlayLayersControlGroup[layerConfig.name || layerConfig.id] = geoJsonLayer

      if (layerConfig.visible !== false) { // Default to visible if not specified
        geoJsonLayer.addTo(map)
      }
      Logger.info(`GeoJSON layer "${layerConfig.name || layerConfig.id}" loaded.`)
    })
  }

  // Update layers control
  if (layersControl) {
    map.removeControl(layersControl) // Remove old control first
  }
  layersControl = L.control.layers(baseLayers, overlayLayersControlGroup).addTo(map)
  Logger.info('Layers control updated.')
}


const initMap = () => {
  try {
    const worldBounds = L.latLngBounds(L.latLng(-85, -180), L.latLng(85, 180))
    map = L.map(mapContainer.value, {
      maxBounds: worldBounds,
      maxBoundsViscosity: 1.0,
      minZoom: 2,
      maxZoom: 18,
    }).setView(props.center, props.zoom)

    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    })
    const esri = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© ESRI' },
    )
    baseLayers = { OpenStreetMap: osm, 'ESRI World Imagery': esri }
    osm.addTo(map)

    // Initial layers control (will be updated by setupLayers)
    layersControl = L.control.layers(baseLayers, {}).addTo(map)

    drawLayer = new L.FeatureGroup()
    map.addLayer(drawLayer)

    map.on(L.Draw.Event.CREATED, (e) => {
      drawLayer.clearLayers()
      const layer = e.layer
      drawLayer.addLayer(layer)
      const bounds = layer.getBounds()
      emit('selection', bounds)
      filterGeoJsonByBounds(bounds) // This will need to pick a layer to filter
      selectionActive.value = true
      selecting.value = false
    })

    Logger.info('Map initialized')
  } catch (err) {
    Logger.error('地图初始化失败', err)
    throw new GISLoadError('地图初始化失败')
  }
}

// Adapted renderGeoJson logic for a specific layer
const renderSingleGeoJsonLayer = (layerId, geoJsonData) => {
  const layerInstance = activeGeoJsonLayers.get(layerId)
  if (!layerInstance) {
    Logger.warn(`Layer with id "${layerId}" not found for rendering.`)
    return
  }

  // If this layer is in the layersControl, we might need to remove and re-add it
  // if its reference changes, but clearLayers().addData() is usually sufficient.
  layerInstance.clearLayers().addData(geoJsonData)

  // Ensure it's on the map if it was previously
  if (!map.hasLayer(layerInstance)) {
     // This might happen if it was initially not visible or removed.
     // Consider if it should be re-added if filtered.
     // For now, assume it's on the map if it's being filtered.
  }
  Logger.info(`GeoJSON data for layer "${layerId}" updated.`);
}


const filterGeoJsonByBounds = (bounds) => {
  // For simplicity, filter the first layer in props.layers that is a point layer
  // or just the first layer if no specific criteria.
  // A more robust solution would involve user selection or layer configuration.
  if (!props.layers || props.layers.length === 0) {
    Logger.warn('No layers available to filter.')
    return
  }

  // Attempt to find a suitable layer to filter (e.g., the first one)
  const layerToFilterConfig = props.layers[0] // Simple: pick the first one
  if (!layerToFilterConfig || !layerToFilterConfig.id) {
     Logger.warn('First layer is invalid or has no ID, cannot filter.')
     return
  }
  
  const targetLayerId = layerToFilterConfig.id
  const originalGeoJson = rawGeoJsonDataMap.get(targetLayerId)

  if (!originalGeoJson || !bounds) {
    Logger.info('No original data for filtering or no bounds for layer:', targetLayerId)
    return
  }
  
  // Check if features exist
  if (!originalGeoJson.features || !Array.isArray(originalGeoJson.features)) {
    Logger.warn(`Layer "${targetLayerId}" has no features array to filter.`)
    return;
  }

  const filteredFeatures = originalGeoJson.features.filter((feature) => {
    if (feature.geometry && feature.geometry.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates
      return bounds.contains(L.latLng(lat, lng))
    }
    // Add filtering for other types if needed, or make it configurable
    return false // By default, only filter points
  })

  const filteredGeoJson = {
    ...originalGeoJson, // Preserve other properties of FeatureCollection
    features: filteredFeatures,
  }

  renderSingleGeoJsonLayer(targetLayerId, filteredGeoJson)
  filteredLayerId = targetLayerId // Mark this layer as filtered
  Logger.info(`Layer "${targetLayerId}" filtered by bounds.`)
}


const toggleSelection = () => {
  selecting.value = !selecting.value
  if (selecting.value && L.Draw && L.Draw.Rectangle) {
    const drawRect = new L.Draw.Rectangle(map, {
      shapeOptions: { color: '#ff7800', weight: 1 },
    })
    drawRect.enable()
  } else if (selecting.value) {
    Logger.error('Leaflet.Draw 未正确加载，无法开启框选')
    selecting.value = false
  }
}

const clearSelection = () => {
  drawLayer.clearLayers()
  if (filteredLayerId) {
    const originalGeoJson = rawGeoJsonDataMap.get(filteredLayerId)
    if (originalGeoJson) {
      renderSingleGeoJsonLayer(filteredLayerId, originalGeoJson)
      Logger.info(`Selection cleared, restored original data for layer "${filteredLayerId}".`)
    }
    filteredLayerId = null
  } else {
    // If no specific layer was filtered, this implies a more general clear.
    // For now, the main effect is clearing the drawLayer.
    Logger.info('Selection cleared (drawLayer). No specific GeoJSON layer was marked as filtered.');
  }
  selectionActive.value = false
}

onMounted(() => {
  initMap()
  // renderGeoJson(props.geoJsonData); // Old call
  setupLayers(props.layers) // New call
})

watch(
  // () => props.geoJsonData, // Old watcher
  () => props.layers,
  (newLayers) => {
    // renderGeoJson(newVal); // Old call
    setupLayers(newLayers) // New call
  },
  { deep: true } // Watch for changes within the layers array and its objects
)

onBeforeUnmount(() => {
  if (map) {
    activeGeoJsonLayers.forEach(layerInstance => map.removeLayer(layerInstance))
    activeGeoJsonLayers.clear()
    rawGeoJsonDataMap.clear()
    if (layersControl) map.removeControl(layersControl)
    map.remove()
    Logger.info('地图销毁')
  }
})
</script>

<style scoped>
.map-container {
  width: 100vw;
  height: 100vh;
  min-height: 400px;
}
.toolbar {
  padding: 8px;
  display: flex;
  gap: 8px;
  position: absolute;
  z-index: 1000;
}
.toolbar button {
  background: #3a6edb;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
}
.toolbar button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}
</style>
