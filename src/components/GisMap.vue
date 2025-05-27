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
  geoJsonData: { type: Object, default: null },
})

const emit = defineEmits(['selection'])

const mapContainer = ref(null)
let map = null
let baseLayers = null
let currentGeoJsonLayer = null
let rawGeoJsonData = null
let drawLayer = null
let selecting = ref(false)
let selectionActive = ref(false) // 是否存在绘制区域

const initMap = () => {
  try {
    const worldBounds = L.latLngBounds(L.latLng(-85, -180), L.latLng(85, 180)) // 接近全球范围
    map = L.map(mapContainer.value, {
      maxBounds: worldBounds,
      maxBoundsViscosity: 1.0, // 阻止拖拽出边界
      minZoom: 2,
      maxZoom: 18,
    }).setView(props.center, props.zoom)

    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    })

    const esri = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '© ESRI',
      },
    )

    baseLayers = {
      OpenStreetMap: osm,
      'ESRI World Imagery': esri,
    }

    osm.addTo(map)
    L.control.layers(baseLayers).addTo(map)

    drawLayer = new L.FeatureGroup()
    map.addLayer(drawLayer)

    map.on(L.Draw.Event.CREATED, (e) => {
      drawLayer.clearLayers()
      const layer = e.layer
      drawLayer.addLayer(layer)

      const bounds = layer.getBounds()
      emit('selection', bounds)
      filterGeoJsonByBounds(bounds)
      selectionActive.value = true
      selecting.value = false
    })

    Logger.info('Map initialized')
  } catch (err) {
    Logger.error('地图初始化失败', err)
    throw new GISLoadError('地图初始化失败')
  }
}

const renderGeoJson = (geoJson) => {
  if (!geoJson) return

  rawGeoJsonData = geoJson

  if (currentGeoJsonLayer) {
    map.removeLayer(currentGeoJsonLayer)
  }

  currentGeoJsonLayer = L.geoJSON(geoJson).addTo(map)
  Logger.info('GeoJSON 数据加载完成')
}

const filterGeoJsonByBounds = (bounds) => {
  if (!rawGeoJsonData || !bounds) return

  const filtered = {
    type: 'FeatureCollection',
    features: rawGeoJsonData.features.filter((feature) => {
      if (feature.geometry.type === 'Point') {
        const [lng, lat] = feature.geometry.coordinates
        return bounds.contains(L.latLng(lat, lng))
      }
      return false
    }),
  }

  renderGeoJson(filtered)
}

const toggleSelection = () => {
  selecting.value = !selecting.value
  if (selecting.value && L.Draw && L.Draw.Rectangle) {
    const drawRect = new L.Draw.Rectangle(map, {
      shapeOptions: { color: '#ff7800', weight: 1 },
    })
    drawRect.enable()
  } else {
    Logger.error('Leaflet.Draw 未正确加载')
  }
}

const clearSelection = () => {
  drawLayer.clearLayers()
  renderGeoJson(rawGeoJsonData)
  selectionActive.value = false
  Logger.info('清除绘图，恢复原始数据')
}

onMounted(() => {
  initMap()
  renderGeoJson(props.geoJsonData)
})

watch(
  () => props.geoJsonData,
  (newVal) => {
    renderGeoJson(newVal)
  },
)

onBeforeUnmount(() => {
  if (map) {
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
