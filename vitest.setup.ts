import { JSDOM } from 'jsdom';

// Basic JSDOM setup for tests that might need a browser-like environment
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost'
});

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator; // For libraries that might check navigator.userAgent etc.
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement; // OpenLayers might use SVGElement for some rendering aspects

// Polyfill for requestAnimationFrame, common requirement for UI/animation libraries in JSDOM
if (!global.window.requestAnimationFrame) {
  global.window.requestAnimationFrame = (cb) => {
    return setTimeout(cb, 0);
  };
}
if (!global.window.cancelAnimationFrame) {
  global.window.cancelAnimationFrame = (id) => {
    clearTimeout(id);
  };
}

// Ensure common Event constructor is available if not already on global
if (typeof global.Event === 'undefined') {
  global.Event = dom.window.Event;
}

// Any other very generic browser globals can be added here if needed by OpenLayers or other libraries.
// For now, keeping it minimal as OpenLayers tests use more targeted mocks.

// The extensive Leaflet 'L_stub' has been removed as Leaflet is no longer part of the project.
console.log('Vitest setup: Basic JSDOM environment configured.');
