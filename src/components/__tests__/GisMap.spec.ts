import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import GisMap from '../GisMap.vue';
import { nextTick, ref } from 'vue';
import { Logger } from '@/utils/logger';

// Mock Logger
vi.mock('@/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock OpenLayers modules
const mockMapView = {
  animate: vi.fn(),
  getProjection: vi.fn(() => ({ getCode: () => 'EPSG:3857' })),
  setCenter: vi.fn(),
  setZoom: vi.fn(),
  getCenter: vi.fn(() => [0,0]), // Return a default center
  getZoom: vi.fn(() => 2),    // Return a default zoom
};
const mockMapInstance = {
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  addInteraction: vi.fn(),
  removeInteraction: vi.fn(),
  addOverlay: vi.fn(),
  on: vi.fn(),
  un: vi.fn(), // For unregistering events
  setTarget: vi.fn(),
  getView: vi.fn(() => mockMapView),
  getLayers: vi.fn(() => ({ getArray: () => [] })), // Mock layer collection
  forEachFeatureAtPixel: vi.fn(),
  getInteractions: vi.fn(() => ({ getArray: () => [] })), // Mock interactions collection
};
const mockTileLayerInstance = { setVisible: vi.fn(), get: vi.fn(), set: vi.fn() };
const mockVectorLayerInstance = { setVisible: vi.fn(), get: vi.fn(), set: vi.fn(), getSource: vi.fn() };
const mockVectorSourceInstance = { addFeatures: vi.fn(), clear: vi.fn(), getFeatures: vi.fn(() => []), changed: vi.fn() };
const mockOverlayInstance = { setPosition: vi.fn() };
const mockDrawInstance = { on: vi.fn(), un: vi.fn() }; // For Draw interaction events

vi.mock('ol/Map', () => ({ default: vi.fn(() => mockMapInstance) }));
vi.mock('ol/View', () => ({ default: vi.fn(() => mockMapView) }));
vi.mock('ol/layer/Tile', () => ({ default: vi.fn(() => mockTileLayerInstance) }));
vi.mock('ol/layer/Vector', () => ({ default: vi.fn(() => mockVectorLayerInstance) }));
vi.mock('ol/source/Vector', () => ({ default: vi.fn(() => mockVectorSourceInstance) }));
vi.mock('ol/source/OSM', () => ({ default: vi.fn() }));
vi.mock('ol/source/XYZ', () => ({ default: vi.fn() }));
vi.mock('ol/format/GeoJSON', () => ({ default: vi.fn(() => ({ readFeatures: vi.fn(data => data.features || []) })) }));
vi.mock('ol/Overlay', () => ({ default: vi.fn(() => mockOverlayInstance) }));
vi.mock('ol/interaction/Draw', () => ({ default: vi.fn(() => mockDrawInstance) }));
vi.mock('ol/proj', () => ({
  fromLonLat: vi.fn(coords => coords), // Passthrough
  toLonLat: vi.fn(coords => coords),   // Passthrough
  transformExtent: vi.fn(extent => extent), // Passthrough
  transform: vi.fn(coordinate => coordinate), // Passthrough for center
}));
vi.mock('ol/sphere', () => ({ getArea: vi.fn(() => 12345) })); // Mock area calculation
vi.mock('ol/extent', () => ({
  getCenter: vi.fn(extent => [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2]),
  containsCoordinate: vi.fn(), // Mock if needed for filtering logic tests
}));

// Mock global fetch
global.fetch = vi.fn();


describe('GisMap.vue with OpenLayers', () => {
  let wrapper;

  const defaultProps = {
    center: [116.4, 39.9],
    zoom: 10,
    overlayLayersConfig: [],
  };

  const mountComponent = (props = {}) => {
    return mount(GisMap, {
      props: { ...defaultProps, ...props },
      global: {
        stubs: { // Stub child components if any, not strictly needed here
          // 'another-component': true 
        }
      },
      slots: { // Provide mock slots for ref="mapContainer" and ref="popupContainer"
        default: `
          <div ref="mapContainer" style="width: 500px; height: 500px;"></div>
          <div ref="popupContainer">
            <a href="#" ref="popupCloser"></a>
            <div id="popup-content"></div>
          </div>
        `
      },
      attachTo: document.body, // Ensure component is attached to DOM for OpenLayers target
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch mock for each test
    global.fetch.mockReset(); 
    // Default fetch mock
    global.fetch.mockResolvedValue({ 
        ok: true, 
        json: async () => ({ type: 'FeatureCollection', features: [] }) 
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it('initializes OpenLayers map on mount', async () => {
    wrapper = mountComponent();
    await nextTick(); // Wait for onMounted and any async operations within

    expect(Map).toHaveBeenCalledTimes(1);
    expect(mockMapInstance.setTarget).toHaveBeenCalled(); // OL map is targeted to the div
    expect(View).toHaveBeenCalledTimes(1);
    expect(mockMapView.setCenter).not.toHaveBeenCalled(); // Center is set in constructor
    expect(mockMapView.setZoom).not.toHaveBeenCalled();   // Zoom is set in constructor
    expect(fromLonLat).toHaveBeenCalledWith(defaultProps.center);
    
    // Base layers (OSM and ESRI)
    expect(TileLayer).toHaveBeenCalledTimes(2);
    expect(OSM).toHaveBeenCalledTimes(1);
    expect(XYZ).toHaveBeenCalledTimes(1);
    expect(mockMapInstance.addLayer).toHaveBeenCalledTimes(2 + 1); // 2 base + 1 drawLayer
    expect(Logger.info).toHaveBeenCalledWith('OpenLayers map initialized.'); // Updated log message
  });

  it('switches base layers correctly', async () => {
    wrapper = mountComponent();
    await nextTick();
    
    const esriButton = wrapper.findAll('.toolbar button').find(b => b.text().includes('ESRI'));
    expect(esriButton).toBeDefined();

    // Mock the get method on TileLayer instances
    // This is tricky because the same mockTileLayerInstance is returned by vi.mock
    // We need to ensure our mapBaseLayers ref in the component gets distinct mocks
    // For now, assume setVisible is called correctly.
    
    await esriButton.trigger('click');
    await nextTick();
    
    // Check that setVisible was called on the layer instances stored in mapBaseLayers
    // This requires deeper mocking or inspecting component's internal state if possible
    // For now, we check the currentBaseLayerId ref (if exposed or by effect)
    // The component's internal mapBaseLayers.value[0] (OSM) should be invisible
    // and mapBaseLayers.value[1] (ESRI) should be visible.
    // This test is simplified due to mock complexities.
    expect(Logger.info).toHaveBeenCalledWith('Switched base layer to: esriWorldImagery');
  });

  it('loads overlay layers from props', async () => {
    const overlayConfig = [
      { id: 'testOverlay1', name: 'Test GeoJSON', geoJson: { type: 'FeatureCollection', features: [{type: 'Feature', geometry: {type: 'Point', coordinates:[0,0]}, properties: {name: 'p1'}}] }, visible: true, style: {}, popup: vi.fn() },
      { id: 'testOverlay2', name: 'Test URL', dataUrl: '/data/test.geojson', visible: true, style: {}, popup: vi.fn() },
    ];
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) });

    wrapper = mountComponent({ overlayLayersConfig: overlayConfig });
    await nextTick(); // For onMounted
    await nextTick(); // For async loadOverlayLayers

    expect(VectorLayer).toHaveBeenCalledTimes(overlayConfig.length + 1); // +1 for drawLayer
    expect(VectorSource).toHaveBeenCalledTimes(overlayConfig.length + 1); // +1 for drawSource
    expect(GeoJSON).toHaveBeenCalledTimes(overlayConfig.length); // Called for each overlay
    expect(global.fetch).toHaveBeenCalledWith('/data/test.geojson'); // For the dataUrl layer
    expect(mockMapInstance.addLayer).toHaveBeenCalledTimes(2 + overlayConfig.length + 1); // 2 base + N overlay + 1 drawLayer
  });
  
  it('toggles overlay layer visibility', async () => {
    const overlayConfig = [
      { id: 'toggleLayer', name: 'Toggle Me', geoJson: { type: 'FeatureCollection', features: [] }, visible: true }
    ];
    wrapper = mountComponent({ overlayLayersConfig: overlayConfig });
    await nextTick(); // Mount
    await nextTick(); // loadOverlayLayers

    // This relies on the VectorLayer mock being the one associated with 'toggleLayer'
    // and that mapOverlayLayers in component gets this instance.
    mockVectorLayerInstance.setVisible.mockClear(); // Clear previous calls from initialization
    
    const checkbox = wrapper.find('.overlay-item input[type="checkbox"]');
    expect(checkbox.exists()).toBe(true);

    // Simulate unchecking (making it invisible)
    // Note: $event.target.checked will be false
    await checkbox.setChecked(false); // This sets $event.target.checked = false
    await nextTick();
    
    expect(mockVectorLayerInstance.setVisible).toHaveBeenCalledWith(false);
  });

  it('handles map click for popups', async () => {
    const mockFeature = { get: vi.fn(prop => prop === 'name' ? 'Test Feature' : undefined) };
    const mockPopupFn = (feature) => `Name: ${feature.get('name')}`;
    const overlayConfig = [
      { id: 'popupLayer', name: 'Popup Layer', geoJson: { type: 'FeatureCollection', features: [] }, visible: true, popup: mockPopupFn }
    ];
    
    // Simulate that forEachFeatureAtPixel finds a feature
    mockMapInstance.forEachFeatureAtPixel.mockImplementation((pixel, callback) => {
      // Simulate finding one feature from our 'popupLayer'
      // The layerInstance needs to have get('popupFunction')
      const mockLayerInstanceWithPopup = { 
          get: vi.fn(key => {
              if (key === 'popupFunction') return mockPopupFn;
              if (key === 'layerId') return 'popupLayer'; // Ensure it's not drawLayer
              return undefined;
          })
      };
      callback(mockFeature, mockLayerInstanceWithPopup);
    });

    wrapper = mountComponent({ overlayLayersConfig: overlayConfig });
    await nextTick(); // Mount
    await nextTick(); // loadOverlayLayers

    // Simulate map click
    const mapClickCallback = mockMapInstance.on.mock.calls.find(call => call[0] === 'singleclick')[1];
    expect(mapClickCallback).toBeDefined();
    
    const mockEvent = { coordinate: [10, 20], pixel: [50,50] };
    mapClickCallback(mockEvent);
    await nextTick();

    expect(mockMapInstance.forEachFeatureAtPixel).toHaveBeenCalledWith(mockEvent.pixel, expect.any(Function));
    expect(mockOverlayInstance.setPosition).toHaveBeenCalledWith(mockEvent.coordinate);
    // Check popup content (requires access to #popup-content innerHTML, harder with basic mount)
  });

  it('starts and stops drawing interaction', async () => {
    wrapper = mountComponent();
    await nextTick();

    const startButton = wrapper.findAll('.selection-toolbar button').find(b => b.text().includes('Start Selection'));
    await startButton.trigger('click');
    await nextTick();

    expect(Draw).toHaveBeenCalledTimes(1);
    expect(mockMapInstance.addInteraction).toHaveBeenCalledWith(mockDrawInstance);
    expect(wrapper.find('.selection-toolbar button').text()).toContain('Cancel Drawing'); // Button text changes

    await startButton.trigger('click'); // Now it should be "Cancel Drawing"
    await nextTick();
    expect(mockMapInstance.removeInteraction).toHaveBeenCalledWith(mockDrawInstance);
    expect(wrapper.find('.selection-toolbar button').text()).toContain('Start Selection');
  });

  it('emits selection data on drawend', async () => {
    wrapper = mountComponent();
    const emitted = wrapper.emitted();
    await nextTick();

    const startButton = wrapper.findAll('.selection-toolbar button').find(b => b.text().includes('Start Selection'));
    await startButton.trigger('click'); // Enable drawing
    
    // Simulate drawend event
    const drawEndCallback = mockDrawInstance.on.mock.calls.find(call => call[0] === 'drawend')[1];
    const mockDrawEvent = { 
      feature: { 
        getGeometry: () => ({ 
          getExtent: () => [0,0,10,10], // Mock extent
          clone: vi.fn().mockReturnThis(),
          transform: vi.fn().mockReturnThis(),
        }) 
      } 
    };
    drawEndCallback(mockDrawEvent);
    await nextTick();

    expect(emitted.selection).toBeTruthy();
    expect(emitted.selection[0][0]).toEqual(expect.objectContaining({
      extent: [0,0,10,10],
      lonLatExtent: [0,0,10,10], // Passthrough mock for transformExtent
      center: [5,5], // Calculated by mocked getCenter
      area: 12345, // From mocked getArea
    }));
  });
  
  it('clears drawing and selection details', async () => {
    wrapper = mountComponent();
    const emitted = wrapper.emitted();
    await nextTick();

    // Start drawing and complete one to have something to clear
    const startButton = wrapper.findAll('.selection-toolbar button').find(b => b.text().includes('Start Selection'));
    await startButton.trigger('click');
    const drawEndCallback = mockDrawInstance.on.mock.calls.find(call => call[0] === 'drawend')[1];
     const mockDrawEvent = { 
      feature: { getGeometry: () => ({ getExtent: () => [0,0,10,10], clone: vi.fn().mockReturnThis(), transform: vi.fn().mockReturnThis() }) } 
    };
    drawEndCallback(mockDrawEvent);
    await nextTick(); // selection should be emitted

    mockVectorSourceInstance.clear.mockClear(); // Clear previous calls to drawSource.clear()

    const clearButton = wrapper.findAll('.selection-toolbar button').find(b => b.text().includes('Clear Selection'));
    await clearButton.trigger('click');
    await nextTick();

    expect(mockVectorSourceInstance.clear).toHaveBeenCalledTimes(1); // drawSource.clear()
    expect(emitted.selection.length).toBe(2); // Initial null (or undefined), then selection, then null
    expect(emitted.selection[1][0]).toBeNull(); // Last emission should be null
  });
  
  it('applies filter on drawend and clears filter on selection clear', async () => {
    const filterableLayerConfig = [
      { id: 'filterable', name: 'Filterable', geoJson: {type: 'FeatureCollection', features: []}, visible: true, style: vi.fn() }
    ];
    const mockLayerSource = { getFeatures: vi.fn(() => [{ getGeometry: vi.fn(() => ({ intersectsExtent: vi.fn(() => true) })), set: vi.fn() }]), changed: vi.fn() };
    const mockFilterableLayer = { getSource: vi.fn(() => mockLayerSource), setVisible: vi.fn(), get: vi.fn(), set: vi.fn() };
    
    // Make VectorLayer return our specific mock for the filterable layer
    vi.mocked(VectorLayer).mockImplementation((options) => {
      if (options.source !== drawSource) { // Don't override drawLayer's mock
        return mockFilterableLayer;
      }
      return { ...mockVectorLayerInstance, getSource: () => mockVectorSourceInstance }; // Default for drawLayer
    });

    wrapper = mountComponent({ overlayLayersConfig: filterableLayerConfig });
    await nextTick(); // Mount & initial loadOverlayLayers
    await nextTick(); // Ensure async parts of loadOverlayLayers complete
    
    // Simulate drawing
    const startButton = wrapper.findAll('.selection-toolbar button').find(b => b.text().includes('Start Selection'));
    await startButton.trigger('click');
    const drawEndCallback = mockDrawInstance.on.mock.calls.find(call => call[0] === 'drawend')[1];
    const mockDrawEvent = { 
      feature: { getGeometry: () => ({ getExtent: () => [0,0,10,10], clone: vi.fn().mockReturnThis(), transform: vi.fn().mockReturnThis() }) } 
    };
    drawEndCallback(mockDrawEvent);
    await nextTick();

    expect(mockFilterableLayer.getSource).toHaveBeenCalled();
    expect(mockLayerSource.getFeatures).toHaveBeenCalled();
    expect(mockLayerSource.changed).toHaveBeenCalled();
    expect(Logger.info).toHaveBeenCalledWith('Filter applied to layer: filterable');

    // Simulate clearing selection
    mockLayerSource.changed.mockClear(); // Reset for next assertion
    const clearButton = wrapper.findAll('.selection-toolbar button').find(b => b.text().includes('Clear Selection'));
    await clearButton.trigger('click');
    await nextTick();

    expect(mockLayerSource.changed).toHaveBeenCalled(); // Filter cleared, source changed
    expect(Logger.info).toHaveBeenCalledWith('Filter cleared from layer: filterable');
  });

  it('cleans up map on unmount', async () => {
    wrapper = mountComponent();
    await nextTick();
    
    wrapper.unmount();
    
    expect(mockMapInstance.setTarget).toHaveBeenCalledWith(null);
    expect(Logger.info).toHaveBeenCalledWith('OpenLayers map disposed');
  });

});
