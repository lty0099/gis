import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { mount } from '@vue/test-utils' // Using @vue/test-utils for component testing
import GisMap from '../GisMap.vue' // Adjust path as needed
import { nextTick, ref } from 'vue'
import { Logger } from '@/utils/logger' // Assuming logger is mockable or simple

// Mock Leaflet and leaflet-draw
const mockMapInstance = {
  setView: vi.fn(),
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  on: vi.fn(),
  remove: vi.fn(),
  hasLayer: vi.fn().mockReturnValue(true), // Assume layers are on map once added for simplicity
  removeControl: vi.fn(),
};
const mockTileLayerInstance = { addTo: vi.fn() };
const mockGeoJSONInstance = { 
  addTo: vi.fn(), 
  clearLayers: vi.fn().mockReturnThis(), 
  addData: vi.fn().mockReturnThis(),
};
const mockFeatureGroupInstance = { 
  addTo: vi.fn(), 
  clearLayers: vi.fn(), 
  addLayer: vi.fn() 
};
const mockLayersControlInstance = { addTo: vi.fn(), removeLayer: vi.fn(), addOverlay: vi.fn() }; // Added addOverlay
const mockDrawRectangleInstance = { enable: vi.fn() };

vi.mock('leaflet', () => ({
  default: {
    map: vi.fn(() => mockMapInstance),
    tileLayer: vi.fn(() => mockTileLayerInstance),
    geoJSON: vi.fn(() => mockGeoJSONInstance),
    featureGroup: vi.fn(() => mockFeatureGroupInstance),
    control: {
      layers: vi.fn(() => mockLayersControlInstance),
    },
    latLngBounds: vi.fn((latlng1, latlng2) => ({
        // Mock bounds methods if needed by the component itself
        contains: vi.fn().mockImplementation((latLng) => {
            // Simple mock: contains if lat is between southWest.lat and northEast.lat
            // This is a very basic mock, real bounds logic is complex.
            // For testing filterGeoJsonByBounds, the mock passed to it matters more.
            if (!latlng1 || !latlng2) return false; // Should not happen with valid bounds
            return latLng.lat >= latlng1.lat && latLng.lat <= latlng2.lat;
        }),
        getNorthEast: vi.fn(() => latlng2 || {lat: 0, lng: 0}),
        getSouthWest: vi.fn(() => latlng1 || {lat: 0, lng: 0}),
    })),
    latLng: vi.fn((lat, lng) => ({ lat, lng })), // Required by bounds.contains
    Draw: { // For leaflet-draw
        Rectangle: vi.fn(() => mockDrawRectangleInstance),
        Event: {
            CREATED: 'draw:created'
        }
    }
  },
}));

// Mock Logger
vi.mock('@/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('GisMap.vue', () => {
  let wrapper;

  const initialProps = {
    center: [0, 0],
    zoom: 2,
    layers: [],
  };
  
  // Helper to mount the component
  const mountComponent = (props = {}) => {
    return mount(GisMap, {
      props: { ...initialProps, ...props },
      // If you need to mock $refs for mapContainer:
      slots: { default: '<div style="height: 500px"></div>' }, // Mock template for map container
      attachTo: document.body, // Necessary if Leaflet tries to access document properties
    });
  };

  beforeEach(() => {
    vi.clearAllMocks(); // Clear all mocks before each test
    // Mock mapContainer.value before component is mounted
    // GisMap.vue uses `ref="mapContainer"`. Vue Test Utils handles this if DOM is available.
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount(); // Unmount the component to trigger onBeforeUnmount
    }
  });

  it('initializes map on mount', async () => {
    wrapper = mountComponent();
    await nextTick(); // Wait for onMounted
    
    expect(L.map).toHaveBeenCalled();
    expect(mockMapInstance.setView).toHaveBeenCalledWith([0,0], 2);
    expect(L.tileLayer).toHaveBeenCalledTimes(2); // OSM and ESRI
    expect(mockTileLayerInstance.addTo).toHaveBeenCalledTimes(3); // 2 base + 1 initial OSM
    expect(L.control.layers).toHaveBeenCalled();
    expect(mockLayersControlInstance.addTo).toHaveBeenCalledWith(mockMapInstance);
    expect(L.featureGroup).toHaveBeenCalled(); // drawLayer
    expect(mockFeatureGroupInstance.addTo).toHaveBeenCalledWith(mockMapInstance); // drawLayer added to map
    expect(Logger.info).toHaveBeenCalledWith('Map initialized');
  });

  describe('Layer Initialization (setupLayers)', () => {
    const sampleLayers = [
      { id: 'layer1', name: 'Layer One', data: { type: 'FeatureCollection', features: [] }, visible: true },
      { id: 'layer2', name: 'Layer Two', data: { type: 'FeatureCollection', features: [] }, visible: false },
      { id: 'layer3', name: 'Layer Three (Default Vis)', data: { type: 'FeatureCollection', features: [] } },
    ];

    it('loads layers from props and adds visible ones to map and control', async () => {
      wrapper = mountComponent({ layers: sampleLayers });
      await nextTick(); // For onMounted then watcher

      expect(L.geoJSON).toHaveBeenCalledTimes(sampleLayers.length);
      
      // activeGeoJsonLayers population and rawGeoJsonDataMap (internal state, harder to test directly without exposing)
      // We test by effects: addTo map and control

      // Layer One (visible: true)
      expect(mockGeoJSONInstance.addTo).toHaveBeenCalledWith(mockMapInstance); // Called for layer1 & layer3
      
      // Layer Two (visible: false) - check that it was NOT added for layer2 specifically
      // This is tricky because mockGeoJSONInstance is a single mock.
      // Instead, verify calls to layersControl.addOverlay
      expect(mockLayersControlInstance.addOverlay).not.toHaveBeenCalled(); // addOverlay is not used in the current setupLayers, layers are passed in constructor

      // Verify L.control.layers was called with the correct overlay group.
      // The mock for L.control.layers needs to capture its arguments or be more sophisticated
      // For now, we check that setupLayers completes and calls log
      expect(Logger.info).toHaveBeenCalledWith('Layers control updated.');
      
      // Check layers added to map. The mockGeoJSONInstance.addTo is a global mock.
      // The current setupLayers calls geoJsonLayer.addTo(map)
      // Layer 1: visible: true -> .addTo(map)
      // Layer 2: visible: false -> not .addTo(map)
      // Layer 3: visible: undefined (defaults to true) -> .addTo(map)
      // So, mockGeoJSONInstance.addTo should be called twice for these layers.
      // Plus base layers. This check needs refinement due to shared mock.
      // A better way is to check map.addLayer for specific layer instances if mocks allow.
      // Given current mocks, this is hard to assert precisely for individual layers.
      // We can count calls to L.geoJSON and assume internal logic based on code review.
      expect(L.geoJSON).toHaveBeenNthCalledWith(1, sampleLayers[0].data, undefined);
      expect(L.geoJSON).toHaveBeenNthCalledWith(2, sampleLayers[1].data, undefined);
      expect(L.geoJSON).toHaveBeenNthCalledWith(3, sampleLayers[2].data, undefined);

      // Based on current GisMap.vue, setupLayers removes old control and adds new.
      // The L.control.layers is called once in initMap, then again in setupLayers.
      // The second call in setupLayers should contain the overlay layers.
      const expectedOverlayGroup = {
        [sampleLayers[0].name]: mockGeoJSONInstance, // Layer 1
        [sampleLayers[1].name]: mockGeoJSONInstance, // Layer 2 (added to control, not map)
        [sampleLayers[2].name]: mockGeoJSONInstance, // Layer 3
      };
      expect(L.control.layers).toHaveBeenLastCalledWith(expect.any(Object), expectedOverlayGroup);
    });

    it('updates layers when props change', async () => {
      wrapper = mountComponent({ layers: [sampleLayers[0]] });
      await nextTick(); // Initial setup
      expect(L.geoJSON).toHaveBeenCalledTimes(1);

      const newSampleLayers = [sampleLayers[1], sampleLayers[2]];
      await wrapper.setProps({ layers: newSampleLayers });
      await nextTick(); // Watcher update

      expect(L.geoJSON).toHaveBeenCalledTimes(1 + newSampleLayers.length); // 1 initial + 2 new
      expect(Logger.info).toHaveBeenCalledWith(`GeoJSON layer "${sampleLayers[1].name}" loaded.`);
      expect(Logger.info).toHaveBeenCalledWith(`GeoJSON layer "${sampleLayers[2].name}" loaded.`);
      expect(Logger.info).多次.toHaveBeenCalledWith('Layers control updated.');
    });
  });

  describe('Filtering Logic (filterGeoJsonByBounds)', () => {
    const filterableLayer = {
      id: 'filterLayer1',
      name: 'Filterable Layer',
      data: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { id: 1 } },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [10, 10] }, properties: { id: 2 } },
        ],
      },
      visible: true,
    };

    beforeEach(async () => {
        // Initialize with the filterable layer
        wrapper = mountComponent({ layers: [filterableLayer] });
        await nextTick(); // Mount and initial setupLayers
        // Ensure L.geoJSON mock is reset for clearLayers/addData calls
        mockGeoJSONInstance.clearLayers.mockClear();
        mockGeoJSONInstance.addData.mockClear();
    });
    
    it('filters features of the first layer based on bounds', async () => {
        const mockBounds = L.latLngBounds(L.latLng(0,0), L.latLng(5,5)); // Contains only first point (1,1)
        
        // Manually trigger the CREATED event that calls filterGeoJsonByBounds
        // This requires finding the on(L.Draw.Event.CREATED, callback) and calling it.
        // Or, if we can get the component instance, call the method directly.
        // For simplicity, let's assume we can call the method.
        // In a real scenario, you might need to simulate the draw event.
        
        // Simulate the component's internal call to filterGeoJsonByBounds
        // This is a bit of a white-box test.
        const instance = wrapper.vm; // Get component instance
        instance.filterGeoJsonByBounds(mockBounds); // This is not directly possible with <script setup>
                                                   // unless filterGeoJsonByBounds is exposed.
                                                   // For this test, let's assume it's callable or simulate the event.
        
        // Simulate draw event instead to trigger filterGeoJsonByBounds
        const drawCreatedCallback = mockMapInstance.on.mock.calls.find(call => call[0] === L.Draw.Event.CREATED)[1];
        const mockDrawnLayer = { getBounds: () => mockBounds };
        drawCreatedCallback({ layer: mockDrawnLayer });
        await nextTick();

        expect(mockGeoJSONInstance.clearLayers).toHaveBeenCalled();
        expect(mockGeoJSONInstance.addData).toHaveBeenCalled();
        
        const addedData = mockGeoJSONInstance.addData.mock.calls[0][0];
        expect(addedData.features.length).toBe(1);
        expect(addedData.features[0].properties.id).toBe(1);
        
        // Check if filteredLayerId is set (requires exposing it or checking its effect)
        // This is an internal state. We can check its effect via clearSelection.
        expect(Logger.info).toHaveBeenCalledWith(`Layer "${filterableLayer.id}" filtered by bounds.`);
    });
  });

  describe('clearSelection', () => {
     const filterableLayer = {
      id: 'filterLayer1',
      name: 'Filterable Layer',
      data: {
        type: 'FeatureCollection',
        features: [ { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] } } ],
      },
      visible: true,
    };

    it('restores original GeoJSON data to the filtered layer and clears drawLayer', async () => {
      wrapper = mountComponent({ layers: [filterableLayer] });
      await nextTick();

      // Simulate filtering first
      const mockBounds = L.latLngBounds(L.latLng(0,0), L.latLng(0,0)); // Filters out the point
      const drawCreatedCallback = mockMapInstance.on.mock.calls.find(call => call[0] === L.Draw.Event.CREATED)[1];
      const mockDrawnLayer = { getBounds: () => mockBounds };
      drawCreatedCallback({ layer: mockDrawnLayer });
      await nextTick();
      
      expect(mockGeoJSONInstance.addData.mock.calls[0][0].features.length).toBe(0); // Ensure it was filtered

      // Now call clearSelection (e.g. by clicking the button)
      const clearButton = wrapper.find('button[title="清除绘图"], button:not([disabled])'); // More robust selector
      // Find the button that calls clearSelection. The second button in the template.
      const buttons = wrapper.findAll('.toolbar button');
      await buttons[1].trigger('click'); // Assuming second button is "清除绘图"
      
      expect(mockFeatureGroupInstance.clearLayers).toHaveBeenCalled(); // drawLayer.clearLayers()
      
      // Check that original data is restored
      expect(mockGeoJSONInstance.clearLayers).toHaveBeenCalledTimes(2); // 1 for filter, 1 for clear
      expect(mockGeoJSONInstance.addData).toHaveBeenCalledTimes(2); //    "          "
      const restoredData = mockGeoJSONInstance.addData.mock.calls[1][0];
      expect(restoredData.features.length).toBe(1); // Original feature restored
      expect(Logger.info).toHaveBeenCalledWith(`Selection cleared, restored original data for layer "${filterableLayer.id}".`)
    });
  });
  
  describe('toggleSelection', () => {
    it('enables draw rectangle on first call if Leaflet.Draw is available', async () => {
        wrapper = mountComponent();
        await nextTick();

        const toggleButton = wrapper.findAll('.toolbar button')[0];
        await toggleButton.trigger('click');

        expect(L.Draw.Rectangle).toHaveBeenCalledWith(mockMapInstance, expect.any(Object));
        expect(mockDrawRectangleInstance.enable).toHaveBeenCalled();
        expect(wrapper.vm.selecting).toBe(true); // Need to expose 'selecting' or test via button text
    });

    it('logs error if Leaflet.Draw.Rectangle is not available when enabling', async () => {
        // Simulate L.Draw.Rectangle being undefined
        const OriginalDraw = L.Draw;
        L.Draw = { ...L.Draw, Rectangle: undefined }; // Temporarily break it

        wrapper = mountComponent();
        await nextTick();
        
        const toggleButton = wrapper.findAll('.toolbar button')[0];
        await toggleButton.trigger('click');

        expect(Logger.error).toHaveBeenCalledWith('Leaflet.Draw 未正确加载，无法开启框选');
        expect(mockDrawRectangleInstance.enable).not.toHaveBeenCalled();
        // expect(wrapper.vm.selecting).toBe(false); // Should be reset

        L.Draw = OriginalDraw; // Restore
    });
  });

  it('cleans up on unmount', async () => {
    wrapper = mountComponent();
    await nextTick(); // for onMounted

    wrapper.unmount();
    expect(mockMapInstance.remove).toHaveBeenCalled();
    expect(Logger.info).toHaveBeenCalledWith('地图销毁');
  });

});
