<template>
  <div>
    <GisMap
      :center="[39.9, 116.4]"
      :zoom="10"
      :layers="mapLayers"
      @selection="handleSelection"
    />
    <div v-if="bounds" class="selection-details">
      <h4>Selection Details:</h4>
      <p>Center: Lat: {{ bounds.center.lat.toFixed(4) }}, Lng: {{ bounds.center.lng.toFixed(4) }}</p>
      <p>Area: {{ bounds.area.toFixed(2) }} sq km</p>
      <p>Bounds:</p>
      <ul>
        <li>North-East: Lat: {{ bounds.northEast.lat.toFixed(4) }}, Lng: {{ bounds.northEast.lng.toFixed(4) }}</li>
        <li>South-West: Lat: {{ bounds.southWest.lat.toFixed(4) }}, Lng: {{ bounds.southWest.lng.toFixed(4) }}</li>
      </ul>
    </div>
    <div v-else>
      <p>No selection made yet. Click "开启框选" and draw a rectangle on the map.</p>
    </div>
  </div>
</template>

<script setup>
import GisMap from '@/components/GisMap.vue'
import { ref, onMounted } from 'vue' // Import onMounted
import L from 'leaflet' // Import Leaflet

const mapLayers = ref([
  {
    id: 'beijing_layer',
    name: 'Beijing Points',
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [116.4, 39.9] },
          properties: { name: 'Beijing Center' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [116.41, 39.91] },
          properties: { name: 'Near Beijing Center' },
        },
      ],
    },
    visible: true,
  },
  {
    id: 'shanghai_layer',
    name: 'Shanghai Point (Initially Hidden)',
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [121.47, 31.23] },
          properties: { name: 'Shanghai Center' },
        },
      ],
    },
    visible: false, // Initially not visible
  },
  {
    id: 'dummy_line_layer',
    name: 'Dummy Line',
    data: {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [110, 35], [115, 38], [120, 35]
                    ]
                },
                properties: { name: 'A Sample Line' }
            }
        ]
    },
    visible: true,
  }
])

const bounds = ref(null)

// onMounted hook to fetch and add the placenames layer
onMounted(async () => {
  try {
    const response = await fetch('/data/placenames.geojson')
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const fetchedGeoJsonData = await response.json()

    const placenamesLayer = {
      id: 'placenames_layer',
      name: 'Place Names (Fetched)',
      data: fetchedGeoJsonData,
      visible: true,
      options: {
        pointToLayer: function (feature, latlng) {
          // Ensure feature and properties exist
          const name = feature && feature.properties && feature.properties.name 
            ? feature.properties.name 
            : 'Unnamed place';
          return L.marker(latlng).bindPopup(name);
        }
      }
    }
    mapLayers.value.push(placenamesLayer)
    console.log('Place Names layer fetched and added successfully.')
  } catch (error) {
    console.error('Error fetching or processing placenames.geojson:', error)
  }
})

function handleSelection(latLngBounds) {
  const northEast = latLngBounds.getNorthEast()
  const southWest = latLngBounds.getSouthWest()
  const center = latLngBounds.getCenter()

  // Calculate area in square kilometers
  // Leaflet's getArea() is not available on L.LatLngBounds directly.
  // A common way is to convert bounds to a polygon and then calculate its area.
  // However, for a simple rectangle, we can calculate it manually or use a helper.
  // For simplicity, I'll approximate using a rough conversion based on latitude.
  // More accurate methods might involve L.GeometryUtil.geodesicArea or projecting.
  
  // Rough approximation of area:
  const earthRadiusKm = 6371
  const lat1 = southWest.lat * Math.PI / 180
  const lat2 = northEast.lat * Math.PI / 180
  const deltaLng = (northEast.lng - southWest.lng) * Math.PI / 180
  
  // Average latitude for width calculation
  const avgLat = (lat1 + lat2) / 2
  
  // Width and height in km
  const width = Math.abs(deltaLng * earthRadiusKm * Math.cos(avgLat))
  const height = Math.abs((lat2 - lat1) * earthRadiusKm)
  const area = width * height // Area in sq km

  bounds.value = {
    northEast: { lat: northEast.lat, lng: northEast.lng },
    southWest: { lat: southWest.lat, lng: southWest.lng },
    center: { lat: center.lat, lng: center.lng },
    area: area,
  }
}
</script>

<style scoped>
.selection-details {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
</style>
