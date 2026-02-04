// Camera Zoom Configuration
// Adjust these values to change camera behavior

export const CAMERA_CONFIG = {
  // Folder mode (viewing the entire folder platform)
  folder: {
    minDistance: 25,        // Closest zoom when viewing folder
    maxDistance: 70,        // Furthest zoom when viewing folder (see multiple rows)
    initialDistance: 70,    // Starting distance on load
    minHeight: 10,          // Height at closest zoom
    maxHeight: 18,          // Height at furthest zoom
    initialHeight: 18       // Starting height
  },

  // Node mode (viewing a selected node up close)
  node: {
    minDistance: 8,         // Closest zoom when viewing a node
    maxDistance: 80,         // Furthest zoom when viewing a node
    selectDistance: 8,       // Distance when first selecting a node
    minHeight: 6,           // Height at closest zoom
    maxHeight: 16           // Height at furthest zoom
  },

  // Deselect threshold (zoom out past this to deselect node)
  deselectThreshold: 55,

  // Animation smoothing (higher = faster, lower = smoother)
  smoothFactor: 4,

  // Zoom speed multiplier
  zoomSpeed: 0.15
};
