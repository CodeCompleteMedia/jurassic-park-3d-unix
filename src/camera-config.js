// Camera Zoom Configuration
// Adjust these values to change camera behavior

export const CAMERA_CONFIG = {
  // Folder mode (viewing the entire folder platform)
  folder: {
    minDistance: 25,      // Closest zoom when viewing folder
    maxDistance: 35,      // Furthest zoom when viewing folder (standard view)
    initialDistance: 50,  // Starting distance on load
    minHeight: 10,        // Height at closest zoom
    maxHeight: 12,        // Height at furthest zoom
    initialHeight: 12     // Starting height
  },

  // Node mode (viewing a selected node up close)
  node: {
    minDistance: 8,       // Closest zoom when viewing a node
    maxDistance: 45,      // Furthest zoom when viewing a node
    selectDistance: 8,    // Distance when first selecting a node
    minHeight: 6,         // Height at closest zoom
    maxHeight: 14         // Height at furthest zoom
  },

  // Deselect threshold (zoom out past this to deselect node)
  deselectThreshold: 38,

  // Animation smoothing (higher = faster, lower = smoother)
  smoothFactor: 4,

  // Zoom speed multiplier
  zoomSpeed: 0.15
};
