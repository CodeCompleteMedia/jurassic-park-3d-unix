import * as THREE from 'three';
import FOLDER_GRAPH from './folders.json' with { type: 'json' };
import { CAMERA_CONFIG } from './camera-config.js';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  colors: {
    background: 0x050607,
    horizonTop: 0x1f3f38,
    gridPrimary: 0x00e0d6,
    gridAccent: 0x4fffe9,
    folderBase: 0xb45a55,
    folderHighlight: 0xc96b63,
    nodeBase: 0x7fd0e6,
    nodeAccent: 0x9be3f3,
    selection: 0xffffff,
    deny: 0xff4a4a,
    win: 0x3a7f63
  },
  depth: {
    levels: 6,
    step: 26,
    startZ: 0
  },
  platform: {
    baseWidth: 32,
    baseDepth: 18,
    height: 1.2,
    reduction: 0.85
  },
  node: {
    count: { min: 9, max: 12 },
    size: { w: 3.2, h: 1.2, d: 3.2 },
    spacing: 4
  },
  camera: {
    fov: 78,
    near: 0.1,
    far: 800,
    defaultPos: new THREE.Vector3(0, 10.5, 26),
    lookAt: new THREE.Vector3(0, 6.5, 0)
  },
  animation: {
    enterDuration: 900,
    fadeDuration: 350,
    denyShake: 120
  }
};

// ============================================
// GAME STATE
// ============================================
const state = {
  currentFolderId: 'root_usr',
  hoveredNodeId: null,
  selectedNodeId: null,
  lastClickTime: 0,
  isTransitioning: false,
  isWon: false,

  // Navigation history: array of folder IDs from root to current
  navigationHistory: ['root_usr'],

  // Camera state
  cameraMode: 'folder', // 'folder' | 'node'
  targetLookAt: new THREE.Vector3(0, 0, 0), // What the camera is looking at
  targetDistance: 35, // Distance from lookAt target
  targetHeight: 12, // Height above lookAt target
  currentLookAt: new THREE.Vector3(0, 0, 0),
  currentDistance: 60,
  currentHeight: 18,
  isAnimating: false,
  lastFolderDistance: CAMERA_CONFIG.folder.maxDistance, // Remember folder zoom level for returning
  nodeZoomDistance: CAMERA_CONFIG.node.selectDistance // Distance when zoomed into a node
};

// ============================================
// THREE.JS SETUP
// ============================================
let scene, camera, renderer, raycaster, mouse;
let nodeMeshes = new Map();
let platformMeshes = new Map();
let folderInstances = new Map();
let connectionLines = null;
let haloMesh = null;
let clock;
let raycastTargets = [];

function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.colors.background);
  scene.fog = new THREE.FogExp2(CONFIG.colors.background, 0.008);

  // Camera
  camera = new THREE.PerspectiveCamera(
    CONFIG.camera.fov,
    window.innerWidth / window.innerHeight,
    CONFIG.camera.near,
    CONFIG.camera.far
  );
  camera.position.copy(CONFIG.camera.defaultPos);
  camera.lookAt(CONFIG.camera.lookAt);

  // Initialize camera state
  const folder = FOLDER_GRAPH[state.currentFolderId];
  const platformZ = CONFIG.depth.startZ - (folder.depth * CONFIG.depth.step);
  state.currentLookAt.set(0, CONFIG.platform.height / 2, platformZ);
  state.targetLookAt.copy(state.currentLookAt);
  state.currentDistance = CAMERA_CONFIG.folder.initialDistance;
  state.targetDistance = CAMERA_CONFIG.folder.initialDistance;
  state.currentHeight = CAMERA_CONFIG.folder.initialHeight;
  state.targetHeight = CAMERA_CONFIG.folder.initialHeight;

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false;
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  // Raycaster
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  clock = new THREE.Clock();

  // Lighting
  setupLighting();

  // World elements
  createFloor();
  createGrid();
  createHorizon();

  // Build initial platforms and nodes
  buildAllPlatforms();
  showCurrentFolder();

  // Connection lines group
  connectionLines = new THREE.Group();
  scene.add(connectionLines);

  // Halo
  createHalo();

  // Event listeners
  setupEventListeners();

  // Hide loading
  setTimeout(() => {
    document.getElementById('loading').classList.add('hidden');
  }, 1000);

  // Animation loop
  animate();
}

function setupLighting() {
  // Ambient light
  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambient);

  // Directional light
  const directional = new THREE.DirectionalLight(0xffffff, 0.6);
  directional.position.set(5, 10, 3);
  scene.add(directional);

  // Hemisphere light with green tint
  const hemisphere = new THREE.HemisphereLight(0x1f3f38, 0x050607, 0.3);
  scene.add(hemisphere);
}

// ============================================
// WORLD CREATION
// ============================================
function createFloor() {
  const geometry = new THREE.PlaneGeometry(400, 400);
  const material = new THREE.MeshLambertMaterial({
    color: 0x08090a,
    side: THREE.DoubleSide
  });
  const floor = new THREE.Mesh(geometry, material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);
}

function createGrid() {
  const gridGroup = new THREE.Group();

  // Main grid
  const gridSize = 180;
  const gridSpacing = 4;
  const gridPoints = [];

  for (let i = -gridSize; i <= gridSize; i += gridSpacing) {
    gridPoints.push(-gridSize, 0, i, gridSize, 0, i);
    gridPoints.push(i, 0, -gridSize, i, 0, gridSize);
  }

  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));

  const gridMaterial = new THREE.LineBasicMaterial({
    color: CONFIG.colors.gridPrimary,
    transparent: true,
    opacity: 0.25
  });

  const grid = new THREE.LineSegments(gridGeometry, gridMaterial);
  gridGroup.add(grid);

  // Scanline band near camera
  const scanlineGeometry = new THREE.PlaneGeometry(400, 3);
  const scanlineMaterial = new THREE.MeshBasicMaterial({
    color: CONFIG.colors.gridPrimary,
    transparent: true,
    opacity: 0.12
  });
  const scanline = new THREE.Mesh(scanlineGeometry, scanlineMaterial);
  scanline.rotation.x = -Math.PI / 2;
  scanline.position.set(0, 0.01, 15);
  gridGroup.add(scanline);

  scene.add(gridGroup);
}

function createHorizon() {
  // Gradient dome using custom shader
  const vertexShader = `
    varying vec3 vWorldPosition;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    uniform vec3 colorBottom;
    uniform vec3 colorTop;
    varying vec3 vWorldPosition;

    void main() {
      float h = normalize(vWorldPosition).y;
      h = h * 0.5 + 0.5;
      vec3 color = mix(colorBottom, colorTop, h);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const uniforms = {
    colorBottom: { value: new THREE.Color(CONFIG.colors.background) },
    colorTop: { value: new THREE.Color(CONFIG.colors.horizonTop) }
  };

  const geometry = new THREE.SphereGeometry(400, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide
  });

  const dome = new THREE.Mesh(geometry, material);
  scene.add(dome);
}

// ============================================
// PLATFORM AND NODE BUILDING
// ============================================
function buildAllPlatforms() {
  Object.values(FOLDER_GRAPH).forEach(folder => {
    createPlatform(folder);
    createNodes(folder);
  });
}

function createPlatform(folder) {
  const nodes = folder.nodes;
  const numNodes = nodes.length;

  // Calculate grid dimensions (as close to square as possible)
  const cols = Math.ceil(Math.sqrt(numNodes));
  const rows = Math.ceil(numNodes / cols);

  // Node dimensions and spacing
  const nodeWidth = CONFIG.node.size.w;
  const nodeDepth = CONFIG.node.size.d;
  const gap = 1.5; // Space between nodes
  const padding = gap * 2; // Padding is 2x the gap (equal space around grid)

  // Calculate total grid dimensions
  const gridWidth = cols * nodeWidth + (cols - 1) * gap;
  const gridDepth = rows * nodeDepth + (rows - 1) * gap;

  // Platform dimensions = grid + padding on all sides
  const width = gridWidth + padding * 2;
  const depth = gridDepth + padding * 2;

  // Scale down slightly for deeper folders
  const scale = Math.pow(0.92, folder.depth);
  const finalWidth = width * scale;
  const finalDepth = depth * scale;

  const depthIndex = folder.depth;
  const zPos = CONFIG.depth.startZ - (depthIndex * CONFIG.depth.step);

  const geometry = new THREE.BoxGeometry(finalWidth, CONFIG.platform.height, finalDepth);
  const material = new THREE.MeshLambertMaterial({
    color: CONFIG.colors.folderBase,
    emissive: CONFIG.colors.folderBase,
    emissiveIntensity: 0.05
  });

  const platform = new THREE.Mesh(geometry, material);
  platform.position.set(0, 0, zPos);
  platform.userData = { folderId: folder.id, width: finalWidth, depth: finalDepth, cols, rows, scale, padding, gap, zPos };

  scene.add(platform);
  platformMeshes.set(folder.id, platform);
}

function createNodes(folder) {
  const depthIndex = folder.depth;
  const platform = platformMeshes.get(folder.id);
  const { cols, rows, scale, gap, zPos } = platform.userData;

  // Calculate platform top Y
  const platformTopY = CONFIG.platform.height / 2 + CONFIG.node.size.h / 2 + 0.1;

  const nodes = folder.nodes;
  const nodeWidth = CONFIG.node.size.w * scale;
  const nodeDepth = CONFIG.node.size.d * scale;
  const actualGap = gap * scale;

  // Calculate total grid dimensions
  const gridWidth = cols * nodeWidth + (cols - 1) * actualGap;
  const gridDepth = rows * nodeDepth + (rows - 1) * actualGap;

  // Calculate starting position to center the entire grid within the platform
  const startX = -gridWidth / 2 + nodeWidth / 2;
  const startZLocal = -gridDepth / 2 + nodeDepth / 2;

  // Calculate spacing between nodes
  const spacingX = nodeWidth + actualGap;
  const spacingZ = nodeDepth + actualGap;

  nodes.forEach((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);

    // Calculate position (add platform Z position to place nodes correctly in world)
    const x = startX + col * spacingX;
    const z = zPos + startZLocal + row * spacingZ;
    const y = platformTopY;

    // Create node mesh
    const geometry = new THREE.BoxGeometry(
      nodeWidth * (node.hintLevel ? 1.1 : 1),
      CONFIG.node.size.h,
      nodeDepth
    );

    // Vary color slightly
    const brightnessVar = 0.92 + Math.random() * 0.16;
    const nodeColor = new THREE.Color(CONFIG.colors.nodeBase);
    nodeColor.multiplyScalar(brightnessVar);

    const material = new THREE.MeshLambertMaterial({
      color: nodeColor,
      emissive: nodeColor,
      emissiveIntensity: 0.1
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.userData = { nodeId: node.id, folderId: folder.id, nodeData: node };

    // Add icon detail on top
    addNodeIcon(mesh, node.icon);

    // Create hit target (invisible, larger)
    const hitGeometry = new THREE.BoxGeometry(CONFIG.node.size.w * 1.5, CONFIG.node.size.h * 2, CONFIG.node.size.d * 1.5);
    const hitMaterial = new THREE.MeshBasicMaterial({
      visible: false,
      side: THREE.DoubleSide
    });
    const hitMesh = new THREE.Mesh(hitGeometry, hitMaterial);
    hitMesh.position.copy(mesh.position);
    hitMesh.userData = { nodeId: node.id, folderId: folder.id, nodeData: node };
    raycastTargets.push(hitMesh);
    scene.add(hitMesh);

    // Store reference
    mesh.userData.hitTarget = hitMesh;
    scene.add(mesh);
    nodeMeshes.set(node.id, { mesh, material, folderId: folder.id });

    // Add label
    createNodeLabel(node, mesh.position);
  });
}

function addNodeIcon(mesh, iconType) {
  const iconGeometry = new THREE.PlaneGeometry(1.5, 1.5);
  const iconMaterial = new THREE.MeshBasicMaterial({
    color: CONFIG.colors.gridAccent,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide
  });

  const icon = new THREE.Mesh(iconGeometry, iconMaterial);
  icon.rotation.x = -Math.PI / 2;
  icon.position.y = CONFIG.node.size.h / 2 + 0.01;
  mesh.add(icon);
}

function createNodeLabel(node, position) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 64;

  ctx.fillStyle = 'transparent';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = 'bold 24px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#00e0d6';
  ctx.shadowColor = '#00e0d6';
  ctx.shadowBlur = 10;
  ctx.fillText(node.label.toUpperCase(), canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });

  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.position.copy(position);
  sprite.position.y += CONFIG.node.size.h + 1.5;
  sprite.scale.set(6, 1.5, 1);

  sprite.userData = { nodeId: node.id, baseOpacity: 0 };
  scene.add(sprite);
  nodeMeshes.get(node.id).label = sprite;
}

function createHalo() {
  const geometry = new THREE.RingGeometry(1.8, 2.2, 32);
  const material = new THREE.MeshBasicMaterial({
    color: CONFIG.colors.selection,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  haloMesh = new THREE.Mesh(geometry, material);
  haloMesh.rotation.x = -Math.PI / 2;
  haloMesh.position.y = 0.02;
  scene.add(haloMesh);
}

function showCurrentFolder() {
  const folder = FOLDER_GRAPH[state.currentFolderId];
  const depthIndex = folder.depth;

  // Reset selection when entering new folder
  state.selectedNodeId = null;
  state.cameraMode = 'folder';

  // Set camera to look at this folder
  setCameraToFolder(state.currentFolderId, false);

  // Show/hide platforms based on depth
  platformMeshes.forEach((mesh, folderId) => {
    const f = FOLDER_GRAPH[folderId];
    mesh.visible = f.depth >= depthIndex - 1 && f.depth <= depthIndex + 2;
  });

  // Show/hide nodes and reset their opacity/material
  nodeMeshes.forEach(({ mesh, label }, nodeId) => {
    const nodeFolderId = mesh.userData.folderId;
    const nodeFolder = FOLDER_GRAPH[nodeFolderId];
    const isVisible = nodeFolder.depth >= depthIndex - 1 && nodeFolder.depth <= depthIndex + 1;
    mesh.visible = isVisible;

    // Reset material opacity and transparency
    mesh.material.opacity = 1;
    mesh.material.transparent = false;

    if (label) {
      label.visible = isVisible;
      label.material.opacity = 1;
    }
  });

  // Rebuild raycast targets from visible nodes
  raycastTargets = [];
  nodeMeshes.forEach(({ mesh }, nodeId) => {
    if (mesh.visible && mesh.userData.hitTarget) {
      raycastTargets.push(mesh.userData.hitTarget);
    }
  });

  updateBreadcrumb();
}

function updateBreadcrumb() {
  const breadcrumbEl = document.getElementById('breadcrumb');
  breadcrumbEl.innerHTML = '';

  state.navigationHistory.forEach((folderId, index) => {
    const folder = FOLDER_GRAPH[folderId];
    const isCurrent = index === state.navigationHistory.length - 1;

    // Create folder element
    const folderSpan = document.createElement('span');
    folderSpan.className = 'folder-item' + (isCurrent ? ' current' : '');
    folderSpan.textContent = '/' + folder.name;
    folderSpan.dataset.folderId = folderId;

    // Add click handler for non-current items
    if (!isCurrent) {
      folderSpan.addEventListener('click', () => navigateToHistoryIndex(index));
    }

    breadcrumbEl.appendChild(folderSpan);

    // Add separator if not last
    if (index < state.navigationHistory.length - 1) {
      const separator = document.createElement('span');
      separator.className = 'path-separator';
      separator.textContent = '/';
      breadcrumbEl.appendChild(separator);
    }
  });
}

function navigateToHistoryIndex(targetIndex) {
  if (state.isTransitioning || state.isWon) return;

  const targetFolderId = state.navigationHistory[targetIndex];
  if (!targetFolderId || targetFolderId === state.currentFolderId) return;

  // Slice history to target index + 1
  state.navigationHistory = state.navigationHistory.slice(0, targetIndex + 1);

  // Navigate to the folder (don't add to history since we're navigating within it)
  enterFolder(targetFolderId, false);
}

// ============================================
// INTERACTION
// ============================================
function setupEventListeners() {
  const canvas = renderer.domElement;

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('dblclick', onDoubleClick);
  canvas.addEventListener('wheel', onWheel);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeyDown);
}

function onMouseMove(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onClick(event) {
  const now = Date.now();
  const isDoubleClick = now - state.lastClickTime < 300;
  state.lastClickTime = now;

  if (state.isTransitioning || state.isWon) return;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(raycastTargets);

  if (intersects.length > 0) {
    const target = intersects[0].object;
    const nodeId = target.userData.nodeId;

    if (isDoubleClick) {
      handleNodeDoubleClick(nodeId);
    } else {
      handleNodeClick(nodeId);
    }
  } else {
    clearSelection();
  }
}

function onDoubleClick(event) {
  // Double click is handled in onClick with timing check
}

function onWheel(event) {
  if (state.isTransitioning || state.isWon) return;

  // Use smooth zoom camera system
  zoomCamera(event.deltaY);
}

function onMouseDown(event) {
  if (event.button === 0 && !state.isTransitioning && !state.isWon) {
    // Left drag for panning
    const startX = event.clientX;
    const startZ = camera.position.x;

    const onMouseMove = (e) => {
      const deltaX = (e.clientX - startX) * 0.05;
      camera.position.x = startZ - deltaX;
      updateCameraLookAt();
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  if (event.button === 2 && !state.isTransitioning && !state.isWon) {
    // Right drag for slight yaw rotation
    const startX = event.clientX;
    const startYaw = camera.rotation.y;

    const onMouseMove = (e) => {
      const deltaX = (e.clientX - startX) * 0.001;
      camera.rotation.y = THREE.MathUtils.clamp(startYaw - deltaX, -0.17, 0.17);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onKeyDown(event) {
  if (document.getElementById('lore-panel').classList.contains('visible')) {
    document.getElementById('lore-panel').classList.remove('visible');
  }
}

function updateCameraLookAt() {
  // Legacy function - kept for compatibility
  const folder = FOLDER_GRAPH[state.currentFolderId];
  const targetZ = CONFIG.depth.startZ - (folder.depth * CONFIG.depth.step);
  // Look at the center of the current folder platform
  camera.lookAt(0, CONFIG.platform.height / 2 + 2, targetZ);
}

// ============================================
// SMOOTH CAMERA SYSTEM
// ============================================
function updateCameraSmooth(delta) {
  const smoothFactor = 1 - Math.exp(-delta * CAMERA_CONFIG.smoothFactor);

  // Smooth interpolation for all camera properties
  state.currentLookAt.lerp(state.targetLookAt, smoothFactor);
  state.currentDistance += (state.targetDistance - state.currentDistance) * smoothFactor;
  state.currentHeight += (state.targetHeight - state.currentHeight) * smoothFactor;

  // Calculate camera position from lookAt, distance, and height
  const camX = state.currentLookAt.x;
  const camY = state.currentLookAt.y + state.currentHeight;
  const camZ = state.currentLookAt.z + state.currentDistance;

  camera.position.set(camX, camY, camZ);
  camera.lookAt(state.currentLookAt.x, state.currentLookAt.y + 2, state.currentLookAt.z);
}

function setCameraToFolder(folderId, zoomIn = true) {
  const folder = FOLDER_GRAPH[folderId];
  const platformZ = CONFIG.depth.startZ - (folder.depth * CONFIG.depth.step);

  // Target is the center of the folder platform
  state.targetLookAt.set(0, CONFIG.platform.height / 2, platformZ);

  // Zoom in to see the whole folder using config values
  const baseDistance = zoomIn ? CAMERA_CONFIG.folder.maxDistance : CAMERA_CONFIG.folder.maxDistance;
  const baseHeight = zoomIn ? CAMERA_CONFIG.folder.maxHeight : CAMERA_CONFIG.folder.maxHeight;
  state.targetDistance = baseDistance;
  state.targetHeight = baseHeight;
  state.cameraMode = 'folder';
}

function updateCameraDebug() {
  const modeEl = document.getElementById('debug-mode');
  const distanceEl = document.getElementById('debug-distance');
  const rangeEl = document.getElementById('debug-range');
  const targetEl = document.getElementById('debug-target');

  if (!modeEl) return;

  // Update mode display
  modeEl.textContent = state.cameraMode.toUpperCase();
  modeEl.className = 'value ' + (state.cameraMode === 'node' ? 'mode-node' : 'mode-folder');

  // Update distance display (rounded)
  distanceEl.textContent = state.currentDistance.toFixed(1);

  // Update range display
  if (state.cameraMode === 'node') {
    rangeEl.textContent = `${CAMERA_CONFIG.node.minDistance} - ${CAMERA_CONFIG.node.maxDistance}`;
  } else {
    rangeEl.textContent = `${CAMERA_CONFIG.folder.minDistance} - ${CAMERA_CONFIG.folder.maxDistance}`;
  }

  // Update target display
  const targetX = state.targetLookAt.x.toFixed(0);
  const targetZ = state.targetLookAt.z.toFixed(0);
  targetEl.textContent = `(${targetX}, ${targetZ})`;
}

function zoomCamera(delta) {
  const zoomSpeed = CAMERA_CONFIG.zoomSpeed;

  // When in node mode, allow zooming out past folder level to deselect
  if (state.cameraMode === 'node') {
    const nodeDeselectThreshold = CAMERA_CONFIG.deselectThreshold;

    state.targetDistance += delta * zoomSpeed * 10;

    // Deselect node if zoomed out far enough
    if (state.targetDistance > nodeDeselectThreshold && state.selectedNodeId) {
      deselectNode();
      // Switch back to folder mode and set folder-level zoom
      state.cameraMode = 'folder';
      state.targetDistance = state.lastFolderDistance;
      return;
    }

    // Clamp to node-level bounds
    const minDistance = CAMERA_CONFIG.node.minDistance;
    const maxDistance = CAMERA_CONFIG.node.maxDistance;
    state.targetDistance = Math.max(minDistance, Math.min(maxDistance, state.targetDistance));
  } else {
    // Folder mode
    const minDistance = CAMERA_CONFIG.folder.minDistance;
    const maxDistance = CAMERA_CONFIG.folder.maxDistance;

    // Remember folder zoom level (but cap it to maxDistance)
    state.lastFolderDistance = Math.min(state.targetDistance, maxDistance);

    state.targetDistance += delta * zoomSpeed * 10;
    state.targetDistance = Math.max(minDistance, Math.min(maxDistance, state.targetDistance));
  }
}

function deselectNode() {
  state.selectedNodeId = null;
  state.cameraMode = 'folder';

  nodeMeshes.forEach(({ material }) => {
    material.emissiveIntensity = 0.1;
  });

  // Clear connections
  while (connectionLines.children.length > 0) {
    connectionLines.remove(connectionLines.children[0]);
  }

  document.getElementById('status-line').textContent = 'SELECT NODE';
}

// ============================================
// SELECTION HANDLING
// ============================================
function handleNodeClick(nodeId) {
  const nodeData = nodeMeshes.get(nodeId);
  if (!nodeData) return;

  state.selectedNodeId = nodeId;
  state.cameraMode = 'node';

  // Center camera on this node and zoom in to node level
  const mesh = nodeData.mesh;
  state.targetLookAt.set(mesh.position.x, mesh.position.y, mesh.position.z);

  // Always zoom to nodeZoomDistance (20) when selecting a node
  state.targetDistance = state.nodeZoomDistance;

  // Update visual selection
  nodeMeshes.forEach(({ mesh, material }, id) => {
    if (id === nodeId) {
      material.emissiveIntensity = 0.3;
    } else {
      material.emissiveIntensity = 0.1;
    }
  });

  // Show connections
  showConnections(nodeId);

  // Update status
  const node = nodeData.mesh.userData.nodeData;
  if (node.type === 'lore') {
    document.getElementById('status-line').textContent = 'PRESS FOR DATA';
  } else if (node.enterable) {
    document.getElementById('status-line').textContent = 'DOUBLE CLICK TO ENTER';
  } else if (node.type === 'trap') {
    document.getElementById('status-line').textContent = 'WARNING: UNSTABLE';
  } else {
    document.getElementById('status-line').textContent = 'SELECT NODE';
  }
}

function clearSelection() {
  deselectNode();
}

function showConnections(fromNodeId) {
  // Clear existing
  while (connectionLines.children.length > 0) {
    connectionLines.remove(connectionLines.children[0]);
  }

  const fromNode = nodeMeshes.get(fromNodeId);
  if (!fromNode) return;

  const nodeData = fromNode.mesh.userData.nodeData;

  // Find children in next folder
  if (nodeData.nextFolderId) {
    const nextFolder = FOLDER_GRAPH[nodeData.nextFolderId];

    nodeMeshes.forEach(({ mesh }, nodeId) => {
      if (mesh.userData.folderId === nextFolder.id) {
        const toMesh = mesh;

        const points = [
          fromNode.mesh.position.clone(),
          toMesh.position.clone()
        ];

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
          color: CONFIG.colors.gridAccent,
          transparent: true,
          opacity: 0.75
        });

        const line = new THREE.Line(geometry, material);
        connectionLines.add(line);
      }
    });
  }
}

function handleNodeDoubleClick(nodeId) {
  const nodeData = nodeMeshes.get(nodeId);
  if (!nodeData) return;

  const node = nodeData.mesh.userData.nodeData;

  if (node.type === 'lore') {
    showLore(node.loreText);
    return;
  }

  if (node.enterable) {
    if (node.nextFolderId === null) {
      // Win condition!
      triggerWin();
    } else {
      // Enter folder
      enterFolder(node.nextFolderId);
    }
  } else if (node.type === 'trap') {
    triggerTrap(node.trapEffect);
  } else if (node.type === 'redHerring') {
    denyAccess(nodeData.mesh);
  }
}

function enterFolder(folderId, addToHistory = true) {
  state.isTransitioning = true;
  document.getElementById('status-line').textContent = 'ACCESSING...';

  // Add to navigation history if this is forward navigation
  if (addToHistory && !state.navigationHistory.includes(folderId)) {
    state.navigationHistory.push(folderId);
  }

  // Set camera target to new folder - will animate smoothly via updateCameraSmooth
  setCameraToFolder(folderId, true);

  const startTime = Date.now();
  const duration = CONFIG.animation.enterDuration;

  // Immediately hide previous folder nodes and show new folder nodes
  const prevFolderId = state.currentFolderId;
  nodeMeshes.forEach(({ mesh, label }, nodeId) => {
    if (mesh.userData.folderId === prevFolderId) {
      mesh.visible = false;
      if (label) label.visible = false;
    }
    if (mesh.userData.folderId === folderId) {
      mesh.visible = true;
      if (label) label.visible = true;
    }
  });

  // Rebuild raycast targets for new folder
  raycastTargets = [];
  nodeMeshes.forEach(({ mesh }, nodeId) => {
    if (mesh.visible && mesh.userData.hitTarget) {
      raycastTargets.push(mesh.userData.hitTarget);
    }
  });

  function animateEnter() {
    const elapsed = Date.now() - startTime;
    const t = Math.min(elapsed / duration, 1);
    const eased = easeInOutCubic(t);

    if (t < 1) {
      requestAnimationFrame(animateEnter);
    } else {
      state.currentFolderId = folderId;
      state.cameraMode = 'folder';
      state.isTransitioning = false;
      showCurrentFolder();
      clearSelection();
      document.getElementById('status-line').textContent = 'SELECT NODE';
    }
  }

  animateEnter();
}

function denyAccess(mesh) {
  const originalColor = mesh.material.color.getHex();
  mesh.material.color.setHex(CONFIG.colors.deny);
  mesh.material.emissive.setHex(CONFIG.colors.deny);
  mesh.material.emissiveIntensity = 0.5;

  // Shake camera
  const originalPos = camera.position.clone();
  const shakeStart = Date.now();

  function shake() {
    const elapsed = Date.now() - shakeStart;
    if (elapsed < CONFIG.animation.denyShake) {
      const intensity = 0.3 * (1 - elapsed / CONFIG.animation.denyShake);
      camera.position.x = originalPos.x + (Math.random() - 0.5) * intensity;
      camera.position.y = originalPos.y + (Math.random() - 0.5) * intensity * 0.5;
      requestAnimationFrame(shake);
    } else {
      camera.position.copy(originalPos);
    }
  }

  shake();

  // Reset color after flash
  setTimeout(() => {
    mesh.material.color.setHex(originalColor);
    mesh.material.emissive.setHex(originalColor);
    mesh.material.emissiveIntensity = 0.1;
  }, 250);

  document.getElementById('status-line').textContent = 'ACCESS DENIED';
  document.getElementById('status-line').classList.add('warning');
  setTimeout(() => {
    document.getElementById('status-line').classList.remove('warning');
    document.getElementById('status-line').textContent = 'SELECT NODE';
  }, 1000);
}

function triggerTrap(effect) {
  document.getElementById('status-line').textContent = 'SYSTEM ERROR';
  document.getElementById('status-line').classList.add('warning');

  if (effect === 'back') {
    // Go back one folder
    const folder = FOLDER_GRAPH[state.currentFolderId];
    const prevFolder = Object.values(FOLDER_GRAPH).find(f => f.depth === folder.depth - 1);
    if (prevFolder) {
      setTimeout(() => {
        enterFolder(prevFolder.id);
      }, 500);
    }
  } else if (effect === 'scramble') {
    // Random camera shake and position offset
    const originalPos = camera.position.clone();
    for (let i = 0; i < 10; i++) {
      setTimeout(() => {
        camera.position.x = originalPos.x + (Math.random() - 0.5) * 2;
        camera.position.y = originalPos.y + (Math.random() - 0.5) * 1;
      }, i * 50);
    }
    setTimeout(() => {
      camera.position.copy(originalPos);
    }, 600);
  } else if (effect === 'lockout') {
    // Temporary lockout
    state.isTransitioning = true;
    setTimeout(() => {
      state.isTransitioning = false;
      document.getElementById('status-line').classList.remove('warning');
    }, 2000);
  }
}

function showLore(text) {
  const panel = document.getElementById('lore-panel');
  document.getElementById('lore-text').textContent = text;
  panel.classList.add('visible');
}

function triggerWin() {
  state.isWon = true;
  document.getElementById('status-line').textContent = 'SYSTEM RESTORED';

  // Animate platform colors to green
  const startTime = Date.now();
  const winColor = new THREE.Color(CONFIG.colors.win);
  const baseColor = new THREE.Color(CONFIG.colors.folderBase);

  function animateWin() {
    const elapsed = Date.now() - startTime;
    const t = Math.min(elapsed / 2000, 1);

    platformMeshes.forEach(mesh => {
      const color = baseColor.clone().lerp(winColor, t);
      mesh.material.color.copy(color);
      mesh.material.emissive.copy(color);
    });

    if (t < 1) {
      requestAnimationFrame(animateWin);
    } else {
      // Show win overlay
      document.getElementById('win-overlay').classList.add('visible');
    }
  }

  animateWin();

  // Brighten grid lines
  const gridLines = scene.children.filter(c => c.type === 'LineSegments');
  gridLines.forEach(line => {
    line.material.opacity = 0.4;
  });

  // Dissolve connections
  const fadeStart = Date.now();
  function fadeConnections() {
    const elapsed = Date.now() - fadeStart;
    const opacity = 1 - Math.min(elapsed / 1000, 1);

    connectionLines.children.forEach(line => {
      line.material.opacity = opacity;
    });

    if (opacity > 0) {
      requestAnimationFrame(fadeConnections);
    } else {
      while (connectionLines.children.length > 0) {
        connectionLines.remove(connectionLines.children[0]);
      }
    }
  }

  setTimeout(fadeConnections, 500);
}

// ============================================
// ANIMATION LOOP
// ============================================
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const time = clock.getElapsedTime();

  // Hover detection
  if (!state.isTransitioning && !state.isWon) {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(raycastTargets);

    // Reset previous hover
    if (state.hoveredNodeId) {
      const prevHover = nodeMeshes.get(state.hoveredNodeId);
      if (prevHover && prevHover.mesh.userData.nodeId !== state.selectedNodeId) {
        prevHover.mesh.position.y = calculateNodeY(prevHover.mesh.userData.folderId);
        prevHover.mesh.scale.set(1, 1, 1);
      }
      if (prevHover && prevHover.label) {
        prevHover.label.material.opacity = 0;
      }
    }

    haloMesh.material.opacity = 0;

    if (intersects.length > 0) {
      const target = intersects[0].object;
      const nodeId = target.userData.nodeId;

      if (nodeId !== state.hoveredNodeId) {
        state.hoveredNodeId = nodeId;

        const nodeData = nodeMeshes.get(nodeId);
        if (nodeData) {
          // Raise node
          const baseY = calculateNodeY(nodeData.mesh.userData.folderId);
          nodeData.mesh.position.y = baseY + 0.15;
          nodeData.mesh.scale.set(1.05, 1, 1.05);

          // Show label
          if (nodeData.label) {
            nodeData.label.material.opacity = 0.9;
          }

          // Move halo
          haloMesh.position.x = nodeData.mesh.position.x;
          haloMesh.position.z = nodeData.mesh.position.z;
          haloMesh.material.opacity = 0.15;
        }
      }
    } else {
      state.hoveredNodeId = null;
    }
  }

  // Subtle node animations
  nodeMeshes.forEach(({ mesh }, id) => {
    if (id === state.hoveredNodeId || id === state.selectedNodeId) return;

    // Subtle float
    const folder = FOLDER_GRAPH[mesh.userData.folderId];
    const baseY = calculateNodeY(folder.id);
    const offset = Math.sin(time * 2 + mesh.position.x * 0.5) * 0.02;
    mesh.position.y = baseY + offset;
  });

  // Halo pulse
  if (haloMesh.material.opacity > 0) {
    haloMesh.material.opacity = 0.15 + Math.sin(time * 4) * 0.05;
  }

  // Smooth camera animation
  updateCameraSmooth(delta);

  // Update debug display
  updateCameraDebug();

  renderer.render(scene, camera);
}

function calculateNodeY(folderId) {
  const folder = FOLDER_GRAPH[folderId];
  const platform = platformMeshes.get(folderId);
  if (!platform) return 0;

  const platformTopY = CONFIG.platform.height / 2;
  return platformTopY + CONFIG.node.size.h / 2 + 0.1;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ============================================
// INITIALIZE
// ============================================
init();
