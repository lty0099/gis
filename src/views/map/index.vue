<template>
  <div>
    <GisMap
      :center="[39.9, 116.4]"
      :zoom="10"
      :geoJsonData="geojson"
      @selection="handleSelection"
    />
    <pre>{{ bounds }}</pre>
  </div>
</template>

<script setup>
import GisMap from '@/components/GisMap.vue'
import { ref } from 'vue'

const geojson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [116.4, 39.9],
      },
      properties: {
        name: 'Beijing',
      },
    },
  ],
}

const bounds = ref(null)

function handleSelection(latLngBounds) {
  bounds.value = {
    northEast: latLngBounds.getNorthEast(),
    southWest: latLngBounds.getSouthWest(),
  }
}
</script>
