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
    step: 45,
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
    size: { w: 5, h: 1.2, d: 5 },
    spacing: 2
  },
  camera: {
    fov: 78,
    near: 0.1,
    far: 800,
    defaultPos: new THREE.Vector3(0, 18, 50),
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
  currentPuzzleId: null,

  // Navigation history: array of folder IDs from root to current
  navigationHistory: ['root_usr'],

  // Puzzle state tracking
  puzzlesSolved: {}, // { folderId: { puzzleId: true } }

  // Camera state
  cameraMode: 'folder', // 'folder' | 'node'
  targetLookAt: new THREE.Vector3(0, 0, 0), // What the camera is looking at
  targetDistance: CAMERA_CONFIG.folder.initialDistance, // Distance from lookAt target
  targetHeight: CAMERA_CONFIG.folder.initialHeight, // Height above lookAt target
  currentLookAt: new THREE.Vector3(0, 0, 0),
  currentDistance: CAMERA_CONFIG.folder.initialDistance,
  currentHeight: CAMERA_CONFIG.folder.initialHeight,
  cameraYaw: 0, // Left/right rotation
  cameraPitch: 0, // Up/down rotation
  isLooking: false, // Currently looking around with right mouse
  isAnimating: false,
  isInitialLoad: true, // Track first load for camera distance
  lastFolderDistance: CAMERA_CONFIG.folder.maxDistance, // Remember folder zoom level for returning
  nodeZoomDistance: CAMERA_CONFIG.node.selectDistance // Distance when zoomed into a node
};

// ============================================
// THREE.JS SETUP
// ============================================
let scene, camera, renderer, raycaster, mouse;
let nodeMeshes = new Map();
let platformMeshes = new Map();
let folderLabels = new Map();
let folderInstances = new Map();
let connectionLines = null;
let haloMesh = null;
let clock;
let raycastTargets = [];

async function init() {
  // Wait for custom font to load before creating text textures
  await document.fonts.load('bold 72px "JpFont"');

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
  // Initialize camera state
  const folder = FOLDER_GRAPH[state.currentFolderId];
  const platformZ = CONFIG.depth.startZ - (folder.depth * CONFIG.depth.step);
  state.currentLookAt.set(0, CONFIG.platform.height / 2, platformZ);
  state.targetLookAt.copy(state.currentLookAt);
  state.currentDistance = CAMERA_CONFIG.folder.initialDistance;
  state.targetDistance = CAMERA_CONFIG.folder.initialDistance;
  state.currentHeight = CAMERA_CONFIG.folder.initialHeight;
  state.targetHeight = CAMERA_CONFIG.folder.initialHeight;

  // Set camera position based on initial distance from folder
  camera.position.set(0, state.currentHeight, platformZ + state.currentDistance);
  camera.lookAt(state.currentLookAt);

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

  // Connection lines group
  connectionLines = new THREE.Group();
  scene.add(connectionLines);

  // Draw permanent folder connections
  drawFolderConnections();

  // Initialize folder view
  showCurrentFolder();
  updateConnectionVisibility();

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

// Calculate folder positions for visual branching layout
function calculateFolderPositions() {
  const positions = {};
  const folderWidths = {};
  const depthFolders = {};

  // First pass: calculate each folder's platform width
  Object.values(FOLDER_GRAPH).forEach(folder => {
    const numNodes = folder.nodes.length;
    const cols = Math.ceil(Math.sqrt(numNodes));
    const nodeWidth = CONFIG.node.size.w;
    const nodeDepth = CONFIG.node.size.d;
    const gap = CONFIG.node.spacing;
    const padding = gap * 2;

    const gridWidth = cols * nodeWidth + (cols - 1) * gap;
    const width = gridWidth + padding * 2;
    const scale = Math.pow(0.92, folder.depth);
    folderWidths[folder.id] = width * scale;
  });

  // Group folders by depth
  Object.values(FOLDER_GRAPH).forEach(folder => {
    if (!depthFolders[folder.depth]) {
      depthFolders[folder.depth] = [];
    }
    depthFolders[folder.depth].push(folder);
  });

  // Calculate X positions with 75 units edge-to-edge
  const edgeGap = 55;

  Object.keys(depthFolders).forEach(depth => {
    const folders = depthFolders[depth];
    const count = folders.length;

    // Calculate total width including gaps
    let totalWidth = 0;
    folders.forEach((folder, index) => {
      totalWidth += folderWidths[folder.id];
      if (index < count - 1) {
        totalWidth += edgeGap;
      }
    });

    // Position folders centered around x=0
    let currentX = -totalWidth / 2;
    folders.forEach((folder, index) => {
      const halfWidth = folderWidths[folder.id] / 2;
      positions[folder.id] = currentX + halfWidth;
      currentX += folderWidths[folder.id] + edgeGap;
    });
  });

  return positions;
}

const FOLDER_POSITIONS = calculateFolderPositions();

function createPlatform(folder) {
  const nodes = folder.nodes;
  const numNodes = nodes.length;

  // Calculate grid dimensions (as close to square as possible)
  const cols = Math.ceil(Math.sqrt(numNodes));
  const rows = Math.ceil(numNodes / cols);

  // Node dimensions and spacing
  const nodeWidth = CONFIG.node.size.w;
  const nodeDepth = CONFIG.node.size.d;
  const gap = CONFIG.node.spacing; // Space between nodes
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

  // Get pre-calculated X position for this folder
  const xPos = FOLDER_POSITIONS[folder.id] || 0;

  const geometry = new THREE.BoxGeometry(finalWidth, CONFIG.platform.height, finalDepth);
  const material = new THREE.MeshLambertMaterial({
    color: CONFIG.colors.folderBase,
    emissive: CONFIG.colors.folderBase,
    emissiveIntensity: 0.05
  });

  const platform = new THREE.Mesh(geometry, material);
  platform.position.set(xPos, 0, zPos);
  platform.userData = { folderId: folder.id, width: finalWidth, depth: finalDepth, cols, rows, scale, padding, gap, zPos, branchOffset: xPos };

  scene.add(platform);
  platformMeshes.set(folder.id, platform);

  // Create floor label below platform
  createFloorLabel(folder, xPos, zPos, finalDepth);
}

function createFloorLabel(folder, xPos, zPos, platformDepth) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 2048;
  canvas.height = 512;

  ctx.fillStyle = 'transparent';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const displayName = folder.name.replace(/^\//, '').toLowerCase();

  ctx.font = 'bold 216px "JpFont", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#c96b63';
  ctx.shadowColor = '#c96b63';
  ctx.shadowBlur = 12;
  ctx.fillText(displayName, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const planeGeometry = new THREE.PlaneGeometry(56, 14);
  const planeMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  const plane = new THREE.Mesh(planeGeometry, planeMaterial);
  plane.position.set(xPos, 0.05, zPos + platformDepth / 2 + 1.5);

  // Lay flat on the floor
  plane.rotation.x = -Math.PI / 2;

  scene.add(plane);
  folderLabels.set(folder.id, plane);
}

// Fisher-Yates shuffle algorithm
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function createNodes(folder) {
  const depthIndex = folder.depth;
  const platform = platformMeshes.get(folder.id);
  const { cols, rows, scale, gap, zPos, branchOffset } = platform.userData;

  // Calculate platform top Y
  const platformTopY = CONFIG.platform.height / 2 + CONFIG.node.size.h / 2 + 0.1;

  // Shuffle nodes for random order (create a copy to avoid modifying original)
  const nodes = shuffleArray([...folder.nodes]);
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

    // Calculate position (add platform Z position and branch offset to place nodes correctly in world)
    const x = branchOffset + startX + col * spacingX;
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

    // Create hit target (invisible, slightly larger but shallower to avoid label interference)
    const hitGeometry = new THREE.BoxGeometry(CONFIG.node.size.w * 1.5, CONFIG.node.size.h * 2, CONFIG.node.size.d);
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

  ctx.font = 'bold 24px "JpFont", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#00e0d6';
  ctx.shadowColor = '#00e0d6';
  ctx.shadowBlur = 10;
  ctx.fillText(node.label.toLowerCase(), canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const planeGeometry = new THREE.PlaneGeometry(12, 3);
  const planeMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  const label = new THREE.Mesh(planeGeometry, planeMaterial);
  label.position.copy(position);
  label.position.z += CONFIG.node.size.d / 2 + 1;
  label.rotation.x = -Math.PI / 2;

  label.userData = { nodeId: node.id, baseOpacity: 0 };
  scene.add(label);
  nodeMeshes.get(node.id).label = label;
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

// Draw permanent bezier curves between connected folders
function drawFolderConnections() {
  // Clear existing
  while (connectionLines.children.length > 0) {
    connectionLines.remove(connectionLines.children[0]);
  }

  // Calculate entry/exit points for each folder
  const folderPoints = {};

  Object.values(FOLDER_GRAPH).forEach(folder => {
    const platform = platformMeshes.get(folder.id);
    if (!platform) return;

    // Exit point - back of folder (negative Z)
    folderPoints[folder.id] = {
      exit: new THREE.Vector3(
        platform.position.x,
        0.2,
        platform.position.z - platform.userData.depth / 2 - 2
      ),
      // Entry point - front of folder (positive Z) - all incoming lines join here
      entry: new THREE.Vector3(
        platform.position.x,
        0.2,
        platform.position.z + platform.userData.depth / 2 + 2
      )
    };
  });

  // Draw curve for each node connection
  Object.values(FOLDER_GRAPH).forEach(folder => {
    const startPoint = folderPoints[folder.id]?.exit;
    if (!startPoint) return;

    folder.nodes.forEach(node => {
      if (node.nextFolderId) {
        const endPoint = folderPoints[node.nextFolderId]?.entry;
        if (!endPoint) return;

        // Create cubic bezier: straight first, then soft +/-35 degree curve
        // P0 = start (back of folder)
        // P1 = go straight for a bit (negative Z)
        // P2 = curve at 35 degrees toward destination X
        // P3 = end (front of destination folder - all lines join here)

        const straightDist = 15; // How far to go straight before curving
        const curveStrength = Math.abs(endPoint.x - startPoint.x) * 0.35; // 35 degree angle

        const p0 = startPoint.clone();
        const p1 = new THREE.Vector3(startPoint.x, 0.2, startPoint.z - straightDist);
        const p2 = new THREE.Vector3(
          startPoint.x + (endPoint.x > startPoint.x ? curveStrength : -curveStrength),
          0.2,
          endPoint.z + straightDist / 2
        );
        const p3 = endPoint.clone();

        const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
        const points = curve.getPoints(30);

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
          color: CONFIG.colors.gridAccent,
          transparent: true,
          opacity: 0.8
        });

        const line = new THREE.Line(geometry, material);
        connectionLines.add(line);
      }
    });
  });
}

// Only update visibility - don't redraw
function updateConnectionVisibility() {
  const depthIndex = FOLDER_GRAPH[state.currentFolderId].depth;

  connectionLines.children.forEach(line => {
    // Check if both folders are visible
    // Lines are at floor level, so just show them
    line.visible = true;
  });
}

function showCurrentFolder() {
  const folder = FOLDER_GRAPH[state.currentFolderId];
  const depthIndex = folder.depth;

  // Reset selection when entering new folder
  state.selectedNodeId = null;
  state.cameraMode = 'folder';

  // Set camera to look at this folder
  setCameraToFolder(state.currentFolderId, true);

  // Redraw folder connections for visible folders
  drawFolderConnections();

  // Build set of folders to always show: current folder + all in navigation history + all reachable folders
  const foldersToShow = new Set();

  // Add all folders in navigation history
  state.navigationHistory.forEach(id => foldersToShow.add(id));

  // Find all reachable folders from navigation history (BFS traversal)
  const queue = [...state.navigationHistory];
  const visited = new Set(state.navigationHistory);

  while (queue.length > 0) {
    const currentId = queue.shift();
    const currentFolder = FOLDER_GRAPH[currentId];

    if (currentFolder && currentFolder.nodes) {
      currentFolder.nodes.forEach(node => {
        if (node.nextFolderId && !visited.has(node.nextFolderId)) {
          visited.add(node.nextFolderId);
          foldersToShow.add(node.nextFolderId);
          queue.push(node.nextFolderId);
        }
      });
    }
  }

  // Show/hide platforms
  platformMeshes.forEach((mesh, folderId) => {
    mesh.visible = foldersToShow.has(folderId);
  });

  // Show/hide floor labels with platforms
  folderLabels.forEach((label, folderId) => {
    label.visible = foldersToShow.has(folderId);
  });

  // Show/hide nodes for visible folders
  nodeMeshes.forEach(({ mesh, label }, nodeId) => {
    const nodeFolderId = mesh.userData.folderId;
    mesh.visible = foldersToShow.has(nodeFolderId);

    // Reset material opacity and transparency
    mesh.material.opacity = 1;
    mesh.material.transparent = false;

    // Show labels for visible folders
    if (label) {
      label.visible = foldersToShow.has(nodeFolderId);
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
    folderSpan.textContent = folder.name.replace(/^\//, '');
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
    // Right drag for looking around (yaw and pitch)
    state.isLooking = true;
    const startX = event.clientX;
    const startY = event.clientY;
    const startYaw = state.cameraYaw;
    const startPitch = state.cameraPitch;

    const onMouseMove = (e) => {
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      // Update yaw (left/right) - smooth rotation
      state.cameraYaw = THREE.MathUtils.clamp(startYaw - deltaX * 0.002, -0.5, 0.5);

      // Update pitch (up/down) - smooth rotation, don't go below floor
      state.cameraPitch = THREE.MathUtils.clamp(startPitch - deltaY * 0.002, -0.3, 0.3);
    };

    const onMouseUp = () => {
      state.isLooking = false;
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

  // Smoothly recenter yaw/pitch when not looking
  if (!state.isLooking) {
    state.cameraYaw += (0 - state.cameraYaw) * smoothFactor * 2;
    state.cameraPitch += (0 - state.cameraPitch) * smoothFactor * 2;
  }

  // Calculate camera position with yaw/pitch
  const yaw = state.cameraYaw || 0;
  const pitch = state.cameraPitch || 0;

  const camX = state.currentLookAt.x + Math.sin(yaw) * state.currentDistance * Math.cos(pitch);
  const camY = state.currentLookAt.y + state.currentHeight + Math.sin(pitch) * state.currentDistance;
  const camZ = state.currentLookAt.z + Math.cos(yaw) * state.currentDistance * Math.cos(pitch);

  // Don't go below floor
  if (camY < 2) {
    camera.position.set(camX, 2, camZ);
  } else {
    camera.position.set(camX, camY, camZ);
  }

  camera.lookAt(state.currentLookAt.x, state.currentLookAt.y + 2, state.currentLookAt.z);
}

function setCameraToFolder(folderId, zoomIn = true) {
  const folder = FOLDER_GRAPH[folderId];
  const platformZ = CONFIG.depth.startZ - (folder.depth * CONFIG.depth.step);

  // Get X position for this folder
  const xPos = FOLDER_POSITIONS[folderId] || 0;

  // Target is the center of the folder platform
  state.targetLookAt.set(xPos, CONFIG.platform.height / 2, platformZ);

  // Use initialDistance only on first load, otherwise use maxDistance
  const useInitial = state.isInitialLoad;
  const baseDistance = useInitial ? CAMERA_CONFIG.folder.initialDistance : CAMERA_CONFIG.folder.maxDistance;
  const baseHeight = useInitial ? CAMERA_CONFIG.folder.initialHeight : CAMERA_CONFIG.folder.maxHeight;
  state.targetDistance = baseDistance;
  state.targetHeight = baseHeight;
  state.cameraMode = 'folder';

  // Clear initial load flag after first set
  if (state.isInitialLoad) {
    state.isInitialLoad = false;
  }
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

  // Update status
  const node = nodeData.mesh.userData.nodeData;
  if (node.type === 'lore') {
    document.getElementById('status-line').textContent = 'PRESS FOR DATA';
  } else if (node.type === 'terminal') {
    // Check if puzzle already solved
    const puzzleId = getPuzzleId(node);
    if (isPuzzleSolved(state.currentFolderId, puzzleId)) {
      document.getElementById('status-line').textContent = 'ACCESS GRANTED - DOUBLE CLICK TO ENTER';
    } else {
      document.getElementById('status-line').textContent = 'AUTH REQUIRED - DOUBLE CLICK TO ENTER';
    }
  } else if (node.type === 'clue') {
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

function handleNodeDoubleClick(nodeId) {
  const nodeData = nodeMeshes.get(nodeId);
  if (!nodeData) return;

  const node = nodeData.mesh.userData.nodeData;

  if (node.type === 'lore') {
    showLore(node.loreText);
    return;
  }

  if (node.type === 'clue') {
    showClue(node.clueId);
    return;
  }

  if (node.type === 'terminal') {
    // Check if puzzle already solved - if so, just enter the folder
    const puzzleId = getPuzzleId(node);
    if (isPuzzleSolved(state.currentFolderId, puzzleId)) {
      // Already solved - just navigate
      if (node.nextFolderId) {
        enterFolder(node.nextFolderId);
      }
    } else {
      showTerminal(node);
    }
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
  if (addToHistory) {
    const existingIndex = state.navigationHistory.indexOf(folderId);
    if (existingIndex !== -1) {
      // Folder already in history - slice to that point (handling branch switching)
      state.navigationHistory = state.navigationHistory.slice(0, existingIndex + 1);
    } else {
      // New folder - add to end
      state.navigationHistory.push(folderId);
    }
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

    const hoveredNodeId = intersects.length > 0 ? intersects[0].object.userData.nodeId : null;

    // Only process changes when hover state actually changes
    if (hoveredNodeId !== state.hoveredNodeId) {
      // Reset previous hover
      if (state.hoveredNodeId) {
        const prevHover = nodeMeshes.get(state.hoveredNodeId);
        if (prevHover && prevHover.mesh.userData.nodeId !== state.selectedNodeId) {
          prevHover.mesh.position.y = calculateNodeY(prevHover.mesh.userData.folderId);
          prevHover.mesh.scale.set(1, 1, 1);
        }
      }

      haloMesh.material.opacity = 0;

      // Set new hover
      if (hoveredNodeId) {
        state.hoveredNodeId = hoveredNodeId;

        const nodeData = nodeMeshes.get(hoveredNodeId);
        if (nodeData) {
          // Raise node
          const baseY = calculateNodeY(nodeData.mesh.userData.folderId);
          nodeData.mesh.position.y = baseY + 0.15;
          nodeData.mesh.scale.set(1.05, 1, 1.05);

          // Move halo
          haloMesh.position.x = nodeData.mesh.position.x;
          haloMesh.position.z = nodeData.mesh.position.z;
          haloMesh.material.opacity = 0.15;
        }
      } else {
        state.hoveredNodeId = null;
      }
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
// PUZZLE SYSTEM
// ============================================

// Puzzle definitions
const PUZZLES = {
  'root_auth': {
    id: 'root_auth',
    name: 'Terminal Access',
    password: 'INGEN-PADDOCK10-MULDOON-1993',
    format: 'PROJECT-SECTOR-KEYWORD-NUMBER (UPPERCASE, hyphens, no spaces)',
    hint: 'Search the /usr directory for clues. Find all 4 parts.',
    clues: {
      project: { found: false, nodeId: 'usr_ingn_memo' },
      sector: { found: false, nodeId: 'paddock_status_log' },
      keyword: { found: false, nodeId: 'incident_report' },
      number: { found: false, nodeId: 'badge_access' }
    }
  }
};

// Node click handlers for puzzle nodes
function handlePuzzleNodeClick(nodeId, nodeType) {
  if (nodeType === 'terminal') {
    const nodeData = nodeMeshes.get(nodeId);
    if (nodeData) {
      const nodeInfo = nodeData.mesh.userData.nodeData;
      showTerminal(nodeInfo);
    }
  } else if (nodeType === 'clue') {
    showClue(nodeId);
  }
}

// Show terminal UI
function showTerminal(node) {
  const overlay = document.getElementById('terminal-overlay');
  const input = document.getElementById('terminal-input');
  const feedback = document.getElementById('terminal-feedback');
  const form = document.getElementById('terminal-form');

  // Store puzzle info
  state.currentPuzzleId = getPuzzleId(node);
  state.currentTerminalNextFolder = node.nextFolderId;

  // Reset state
  input.value = '';
  feedback.className = '';
  feedback.innerHTML = '';
  feedback.style.display = 'none';
  document.querySelector('.terminal-close-hint').style.display = 'block';

  // Reset all part indicators
  const partNames = ['project', 'sector', 'keyword', 'number'];
  const puzzle = PUZZLES['root_auth'];
  for (const part of partNames) {
    const partEl = document.getElementById(`part-${part}`);
    if (partEl) {
      // Reset to default, then add 'found' if clue was discovered
      partEl.className = 'password-part';
      if (puzzle.clues[part]?.found) {
        partEl.classList.add('found');
      }
    }
  }

  overlay.classList.add('visible');

  // Focus input and setup form submission
  setTimeout(() => {
    input.focus();

    // Remove old submit handler if exists
    form.onsubmit = null;

    // Add form submit handler (triggers on Enter)
    form.onsubmit = (e) => {
      e.preventDefault();
      submitPassword();
    };
  }, 100);
}

function handleTerminalKeydown(e) {
  if (e.key === 'Enter') {
    submitPassword();
  } else if (e.key === 'Escape') {
    closeTerminal();
  }
}

// ESC key closes terminal modal even when input not focused
document.addEventListener('keydown', (e) => {
  // Close terminal on ESC
  if (e.key === 'Escape') {
    const terminalOverlay = document.getElementById('terminal-overlay');
    if (terminalOverlay.classList.contains('visible')) {
      closeTerminal();
      return;
    }
  }

  // Close clue panel on any key (except Tab)
  const cluePanel = document.getElementById('clue-panel');
  if (cluePanel.classList.contains('visible') && e.key !== 'Tab') {
    closeClue();
  }
});

function submitPassword() {
  const input = document.getElementById('terminal-input');
  const feedback = document.getElementById('terminal-feedback');
  const password = input.value.trim().toUpperCase();
  const puzzle = PUZZLES[state.currentPuzzleId] || PUZZLES['root_auth'];

  if (!password) {
    feedback.className = 'visible warning';
    feedback.style.display = 'block';
    feedback.innerHTML = 'AUTH FAIL: NO INPUT DETECTED';
    return;
  }

  // Validate format
  const parts = password.split('-');
  if (parts.length !== 4) {
    feedback.className = 'visible warning';
    feedback.style.display = 'block';
    feedback.innerHTML = 'AUTH FAIL: INVALID FORMAT (EXPECTED 4 PARTS)';
    return;
  }

  // Check each part - only light up correct ones
  const partNames = ['PROJECT', 'SECTOR', 'KEYWORD', 'NUMBER'];
  const correctParts = puzzle.password.split('-');
  let allCorrect = true;

  for (let i = 0; i < 4; i++) {
    const partEl = document.getElementById(`part-${partNames[i].toLowerCase()}`);
    if (parts[i] === correctParts[i]) {
      partEl.className = 'password-part valid';
    } else {
      allCorrect = false;
    }
  }

  if (allCorrect) {
    feedback.className = 'visible success';
    feedback.style.display = 'block';
    feedback.innerHTML = '<div style="text-align: center;"><div style="font-size: 16px; margin-bottom: 15px;">*** AUTH OK: ACCESS GRANTED ***</div><button id="nav-continue-btn" class="terminal-nav-btn" onclick="continueToNextFolder()">CONTINUE &gt;&gt;</button></div>';
    // Hide the ESC cancel hint
    document.querySelector('.terminal-close-hint').style.display = 'none';
  } else {
    feedback.className = 'visible error';
    feedback.style.display = 'block';
    feedback.innerHTML = 'AUTH FAILED: INVALID CREDENTIALS<br>HINT: Check your clue files for the correct parts.';
  }
}

// Global function for continue button
window.continueToNextFolder = function() {
  closeTerminal();
  unlockPuzzle(state.currentPuzzleId, state.currentTerminalNextFolder);
};

function closeTerminal() {
  const overlay = document.getElementById('terminal-overlay');
  const form = document.getElementById('terminal-form');
  form.onsubmit = null;
  overlay.classList.remove('visible');
}

function unlockPuzzle(puzzleId, nextFolderId) {
  const puzzle = PUZZLES[puzzleId];
  if (!puzzle) return;

  // Track solved puzzle
  if (!state.puzzlesSolved[state.currentFolderId]) {
    state.puzzlesSolved[state.currentFolderId] = {};
  }
  state.puzzlesSolved[state.currentFolderId][puzzleId] = true;

  // Use provided nextFolderId or find from terminal node
  const destinationFolder = nextFolderId || state.currentTerminalNextFolder;
  if (destinationFolder) {
    enterFolder(destinationFolder);
  }
}

function showClue(nodeId) {
  const panel = document.getElementById('clue-panel');
  const title = document.getElementById('clue-title');
  const content = document.getElementById('clue-text');

  const clueTexts = {
    'usr_ingn_memo': {
      title: 'ops_memo.txt',
      text: `InGen Operations
-----------
To: All Staff
From: Admin
Date: 1993

ATTENTION: All procurement requests must reference the main PROJECT code:

>>> PROJECT: <span style="color: #ff6b6b; font-weight: bold; font-size: 1.2em;">INGEN</span> <<<

Do not forget to include sector designation in all field documentation.

--
InGen Operations | Isla Nublar | Asset Control`
    },
    'paddock_status_log': {
      title: 'paddock_status.log',
      text: `PADDOCK STATUS LOG
================
Timestamp: 1993-06-15 14:32:01

> SECTOR: <span style="color: #4ecdc4; font-weight: bold; font-size: 1.2em;">PADDOCK10</span>
> STATUS: MONITORING
> ANIMALS: 7
> FENCE: ACTIVE

Last maintenance: 1993-05-20
Next inspection: 1993-07-01`
    },
    'incident_report': {
      title: 'incident_report_06.txt',
      text: `INCIDENT REPORT #06
===============
Date: 1993-06-15
Reported by: R. Muldoon

SUBJECT: Fence Power Anomaly

Field staff report: Unexpected fence power drop in sector.
Manual override required.

NOTE: For any auth code questions, contact:

>>> <span style="color: #ffe66d; font-weight: bold; font-size: 1.2em;">MULDOON</span> <<<

Attachments: fence_diagram.pdf ( corrupted )`
    },
    'badge_access': {
      title: 'badge_access.log',
      text: `BADGE ACCESS LOG
=============
AUTH CODE: <span style="color: #a8e6cf; font-weight: bold; font-size: 1.2em;">1993</span>

[ACCESS] 06:00 - Security Station
[ACCESS] 08:15 - Main Control
[ACCESS] 12:30 - Embryo Storage
[ACCESS] 14:00 - Paddock 10 Entry

NOTE: Auth codes reset quarterly. Current code valid until next audit.`
    },
    'readme_access': {
      title: 'README_ACCESS.txt',
      text: `PASSWORD FORMAT
=============
WARNING: This system requires authentication before
accessing protected folders.

Format: PROJECT-SECTOR-KEYWORD-NUMBER
Rules:
  - All UPPERCASE
  - Use hyphens between parts
  - NO SPACES
  - Example: COMPANY-ZONE-NAME-1234

Collect all 4 parts from files in this directory.
Each part is hidden in a different file and highlighted in bold.`
    }
  };

  const clue = clueTexts[nodeId];
  if (clue) {
    title.textContent = `[root@park:${clue.title}]`;
    content.innerHTML = clue.text;
    panel.classList.add('visible');

    // Mark clue as found in puzzle state
    const puzzle = PUZZLES['root_auth'];
    for (const [part, clueData] of Object.entries(puzzle.clues)) {
      if (clueData.nodeId === nodeId) {
        clueData.found = true;
        break;
      }
    }
  }
}

function closeClue() {
  const panel = document.getElementById('clue-panel');
  panel.classList.remove('visible');
}

// Check if puzzle is solved
function isPuzzleSolved(folderId, puzzleId) {
  return state.puzzlesSolved[folderId]?.[puzzleId] === true;
}

// Get puzzle ID from node - always use root_auth for main puzzle
function getPuzzleId(node) {
  // All terminals use the same puzzle for now
  return 'root_auth';
}

// ============================================
// INITIALIZE
// ============================================
init();
