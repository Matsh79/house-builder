// Dimensions taken from the real house plans (Kjerne 150, Neo Hytter)
const LENGTH = 18.116; // long axis (m)
const DEPTH = 8.28;    // short axis (m)
const EAVE = 2.87;     // wall height up to roofline (m)
const RIDGE = 5.26;    // roof peak height (m)
const WALL_T = 0.2;
const ROOF_T = 0.1;

const half = DEPTH / 2;
const rise = RIDGE - EAVE;
const slopeLen = Math.sqrt(half * half + rise * rise);
const pitch = Math.atan2(rise, half);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(18, 11, 22);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target.set(0, EAVE, 0);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(15, 20, 10);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0x7cb342 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const houseGroup = new THREE.Group();
houseGroup.position.set(-LENGTH / 2, 0, -half);
scene.add(houseGroup);

const woodMat = new THREE.MeshStandardMaterial({ color: 0xcbb994, flatShading: true });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, flatShading: true, side: THREE.DoubleSide });
const windowMat = new THREE.MeshStandardMaterial({ color: 0x9fd3e8, transparent: true, opacity: 0.75 });
const doorMat = new THREE.MeshStandardMaterial({ color: 0x5b3a29 });
const interiorMat = new THREE.MeshStandardMaterial({ color: 0xf0ead9, flatShading: true });

const draggableWalls = [];

const POKE = WALL_T + 0.05; // thicker than the wall so cutouts poke through both faces

function addWindow(parent, x, y, z, w, h, axis) {
  const geo = axis === "x"
    ? new THREE.BoxGeometry(POKE, h, w)
    : new THREE.BoxGeometry(w, h, POKE);
  const win = new THREE.Mesh(geo, windowMat);
  win.position.set(x, y, z);
  parent.add(win);
}

function addDoor(parent, x, y, z, w, h, axis) {
  const geo = axis === "x"
    ? new THREE.BoxGeometry(POKE, h, w)
    : new THREE.BoxGeometry(w, h, POKE);
  const door = new THREE.Mesh(geo, doorMat);
  door.position.set(x, y, z);
  parent.add(door);
}

// Gable prism: triangular pediment above eave height, built directly so
// X = thickness, Y = height, Z = depth (no confusing geometry rotations).
function makeGablePrism() {
  const A0 = [0, EAVE, 0], B0 = [0, EAVE, DEPTH], C0 = [0, RIDGE, half];
  const A1 = [WALL_T, EAVE, 0], B1 = [WALL_T, EAVE, DEPTH], C1 = [WALL_T, RIDGE, half];
  const pts = [A0, B0, C0, A1, B1, C1].flat();
  const idx = [
    0, 1, 2,       // front triangle
    3, 5, 4,       // back triangle
    0, 2, 5, 0, 5, 3, // slope 1 (z=0 side)
    2, 1, 4, 2, 4, 5  // slope 2 (z=DEPTH side)
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, woodMat);
}

function makeGableWall(xPos, outwardSign) {
  const group = new THREE.Group();
  const lower = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, EAVE, DEPTH), woodMat);
  lower.position.set(WALL_T / 2, EAVE / 2, half);
  group.add(lower);
  const prism = makeGablePrism();
  group.add(prism);
  group.position.x = xPos;
  houseGroup.add(group);
  group.userData.restPosition = group.position.clone();
  group.userData.axis = new THREE.Vector3(outwardSign, 0, 0);
  group.userData.centerY = EAVE / 2;
  group.userData.dragMin = -0.3;
  group.userData.dragMax = 1.5;
  draggableWalls.push(group);
  return group;
}

function makeLongWall(zPos, outwardSign) {
  const group = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(LENGTH, EAVE, WALL_T), woodMat);
  wall.position.set(LENGTH / 2, EAVE / 2, 0);
  group.add(wall);
  group.position.z = zPos;
  houseGroup.add(group);
  group.userData.restPosition = group.position.clone();
  group.userData.axis = new THREE.Vector3(0, 0, outwardSign);
  group.userData.centerY = EAVE / 2;
  group.userData.dragMin = -0.3;
  group.userData.dragMax = 1.5;
  draggableWalls.push(group);
  return group;
}

const gableSouth = makeGableWall(0, -1);
const gableNorth = makeGableWall(LENGTH - WALL_T, 1);
const wallWest = makeLongWall(0, -1);
const wallEast = makeLongWall(DEPTH - WALL_T, 1);

// --- interior partition walls (thinner, lighter, shorter drag range) ---
const INT_T = 0.1;
const INT_H = 2.4;

function makeInteriorWallX(xPos, z0, z1) {
  const len = z1 - z0;
  const group = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(INT_T, INT_H, len), interiorMat);
  wall.position.set(0, INT_H / 2, z0 + len / 2);
  group.add(wall);
  group.position.x = xPos;
  houseGroup.add(group);
  group.userData.restPosition = group.position.clone();
  group.userData.axis = new THREE.Vector3(1, 0, 0);
  group.userData.centerY = INT_H / 2;
  group.userData.dragMin = -0.6;
  group.userData.dragMax = 0.6;
  draggableWalls.push(group);
  return group;
}

function makeInteriorWallZ(zPos, x0, x1) {
  const len = x1 - x0;
  const group = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(len, INT_H, INT_T), interiorMat);
  wall.position.set(x0 + len / 2, INT_H / 2, 0);
  group.add(wall);
  group.position.z = zPos;
  houseGroup.add(group);
  group.userData.restPosition = group.position.clone();
  group.userData.axis = new THREE.Vector3(0, 0, 1);
  group.userData.centerY = INT_H / 2;
  group.userData.dragMin = -0.6;
  group.userData.dragMax = 0.6;
  draggableWalls.push(group);
  return group;
}

// Layout approximates the real floor plan: living/kitchen open on one end,
// 3 bedrooms across the top of the other end, hallway/entry/bath/laundry/sauna below.
makeInteriorWallX(6.7, 0, DEPTH);        // living/kitchen | rest of house
makeInteriorWallX(10.439, 0, 3.0);       // bedroom 1 | bedroom 2
makeInteriorWallX(14.178, 0, 3.0);       // bedroom 2 | bedroom 3
makeInteriorWallZ(3.0, 6.7, LENGTH);     // bedrooms | hallway
makeInteriorWallZ(4.5, 6.7, LENGTH);     // hallway | entry/bath/laundry wing
makeInteriorWallX(9.2, 4.5, DEPTH);      // entry | bathroom 1
makeInteriorWallZ(6.0, 9.2, 13.3);       // entry | bathrooms (upper edge)
makeInteriorWallX(11.0, 6.0, DEPTH);     // bathroom 1 | bathroom 2
makeInteriorWallX(13.3, 4.5, DEPTH);     // bathroom 2 | laundry/sauna
makeInteriorWallX(15.5, 4.5, 6.0);       // laundry | sauna
makeInteriorWallZ(6.0, 15.5, LENGTH);    // sauna | laundry (lower edge)

// windows/doors (approximate, matching the facade drawings)
// parented to the wall GROUP (not the mesh) so coordinates are in the
// group's own local space and line up with the wall itself
addWindow(wallWest, 2.5, 1.6, 0, 1.0, 1.1, "z");
addWindow(wallWest, 4.2, 1.6, 0, 1.0, 1.1, "z");
addWindow(wallWest, 5.9, 1.6, 0, 1.0, 1.1, "z");
addWindow(wallWest, 8.5, 1.7, 0, 1.6, 1.6, "z");
addWindow(wallWest, 11, 1.7, 0, 1.8, 1.8, "z");
addWindow(wallWest, 14, 1.7, 0, 1.8, 1.8, "z");

addDoor(wallEast, 3.2, 1.05, 0, 1.6, 2.1, "z");
addWindow(wallEast, 1.2, 1.6, 0, 0.9, 1.0, "z");
addWindow(wallEast, 6, 1.6, 0, 0.9, 1.0, "z");

addDoor(gableSouth, 0, 1.05, 3.5, 1.6, 2.1, "x");
addWindow(gableSouth, 0, 1.6, 5.5, 1.4, 1.4, "x");
addWindow(gableSouth, 0, 1.6, 1.5, 1.0, 1.0, "x");

addWindow(gableNorth, 0, 1.5, 2, 1.0, 1.6, "x");
addWindow(gableNorth, 0, 1.5, 6, 1.0, 1.6, "x");
addWindow(gableNorth, 0, RIDGE - 0.9, half, 1.2, 1.2, "x");

// --- furniture (simple low-poly boxes, matching the toy-house look) ---
function furn(w, h, d, x, y, z, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, flatShading: true })
  );
  mesh.position.set(x, y, z);
  houseGroup.add(mesh);
  return mesh;
}

// living / kitchen (x 0-6.7, z 0-8.28)
furn(2.0, 0.4, 0.6, 2.0, 0.2, 0.7, 0x6b8f8a);     // sofa seat
furn(2.0, 0.5, 0.15, 2.0, 0.65, 0.375, 0x5c7d78);  // sofa backrest
furn(0.9, 0.35, 0.5, 2.0, 0.175, 1.7, 0x9c7a52);   // coffee table
furn(1.6, 0.08, 0.9, 5.3, 0.75, 2.5, 0x9c7a52);    // dining table
furn(0.4, 0.4, 0.4, 4.6, 0.2, 1.9, 0x7a5c46);      // chair
furn(0.4, 0.4, 0.4, 6.0, 0.2, 1.9, 0x7a5c46);      // chair
furn(0.4, 0.4, 0.4, 4.6, 0.2, 3.1, 0x7a5c46);      // chair
furn(0.4, 0.4, 0.4, 6.0, 0.2, 3.1, 0x7a5c46);      // chair
furn(1.8, 0.9, 0.6, 1.3, 0.45, 7.9, 0xd8d2c4);     // kitchen counter
furn(0.5, 0.05, 0.5, 1.3, 0.925, 7.9, 0x333333);   // stove top

// bedrooms (3 cells across x 6.7-17.916, z 0-3.0)
const bedCenters = [8.57, 12.31, 16.05];
const bedColors = [0xdba6a6, 0xa6c3db, 0xc9dba6];
bedCenters.forEach((cx, i) => {
  furn(1.4, 0.3, 2.0, cx, 0.15, 1.1, bedColors[i]);   // mattress
  furn(1.4, 0.6, 0.1, cx, 0.35, 0.15, 0x9c7a52);      // headboard
  furn(1.2, 0.15, 0.35, cx, 0.375, 0.3, 0xffffff);    // pillow
  furn(0.4, 0.4, 0.4, cx + 0.9, 0.2, 0.3, 0x9c7a52);  // nightstand
});

// entry (x 6.7-9.2, z 4.5-8.28)
furn(1.0, 0.4, 0.4, 7.4, 0.2, 7.6, 0x7a5c46);   // bench
furn(0.8, 0.9, 0.25, 7.4, 0.45, 4.7, 0x9c7a52); // shelf

// bathrooms (bath1 x 9.2-11.0, bath2 x 11.0-13.3, both z 6.0-8.28)
[10.1, 12.15].forEach((cx) => {
  furn(0.35, 0.35, 0.4, cx, 0.175, 8.0, 0xffffff); // toilet base
  furn(0.3, 0.3, 0.12, cx, 0.5, 7.85, 0xffffff);   // toilet tank
  furn(0.4, 0.15, 0.3, cx - 0.7, 0.8, 6.15, 0xffffff); // sink
});

// laundry (x 13.3-17.916, z 6.0-8.28, minus the sauna corner)
furn(0.6, 0.85, 0.6, 14.0, 0.425, 7.9, 0x4a4a4a);  // washing machine
furn(0.6, 0.85, 0.6, 14.7, 0.425, 7.9, 0x5a5a5a);  // dryer
furn(2.0, 0.8, 0.5, 16.4, 0.4, 7.9, 0xd8d2c4);     // storage counter

// sauna (x 15.5-17.916, z 4.5-6.0)
furn(0.5, 0.45, 1.0, 17.5, 0.225, 5.25, 0x9c7a52); // bench
furn(0.3, 0.4, 0.3, 15.7, 0.2, 4.7, 0x2b2b2b);     // heater

// --- roof: two hinged panels meeting at the ridge ---
const pivotWest = new THREE.Group();
pivotWest.position.set(LENGTH / 2, RIDGE, half);
pivotWest.rotation.x = -pitch;
houseGroup.add(pivotWest);
const panelWest = new THREE.Mesh(new THREE.BoxGeometry(LENGTH + 0.4, ROOF_T, slopeLen), roofMat);
panelWest.position.set(0, 0, -slopeLen / 2);
pivotWest.add(panelWest);

const pivotEast = new THREE.Group();
pivotEast.position.set(LENGTH / 2, RIDGE, half);
pivotEast.rotation.x = pitch;
houseGroup.add(pivotEast);
const panelEast = new THREE.Mesh(new THREE.BoxGeometry(LENGTH + 0.4, ROOF_T, slopeLen), roofMat);
panelEast.position.set(0, 0, slopeLen / 2);
pivotEast.add(panelEast);

const CLOSED_WEST = -pitch, OPEN_WEST = Math.PI / 2;
const CLOSED_EAST = pitch, OPEN_EAST = -Math.PI / 2;
let roofOpen = false;
const roofBtn = document.getElementById("roofBtn");
roofBtn.addEventListener("click", () => {
  roofOpen = !roofOpen;
  roofBtn.textContent = roofOpen ? "Close Roof" : "Open Roof";
});

// --- wall dragging ---
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const planeHit = new THREE.Vector3();
let draggedWall = null;

function setPointerNDC(e) {
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

const wallMeshes = [];
draggableWalls.forEach(w => w.children.forEach(c => {
  if (c.geometry.type === "BoxGeometry" || c.geometry.type === "BufferGeometry") {
    c.userData.wallRoot = w;
    wallMeshes.push(c);
  }
}));

renderer.domElement.addEventListener("pointerdown", (e) => {
  setPointerNDC(e);
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(wallMeshes, false);
  if (hits.length) {
    draggedWall = hits[0].object.userData.wallRoot;
    const worldY = draggedWall.userData.centerY;
    dragPlane.set(new THREE.Vector3(0, 1, 0), -worldY);
    controls.enabled = false;
  }
});

window.addEventListener("pointermove", (e) => {
  if (!draggedWall) return;
  setPointerNDC(e);
  raycaster.setFromCamera(pointerNDC, camera);
  if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
    const rest = draggedWall.userData.restPosition;
    const axis = draggedWall.userData.axis;
    const worldRest = rest.clone().add(houseGroup.position);
    const offset = THREE.MathUtils.clamp(
      planeHit.clone().sub(worldRest).dot(axis),
      draggedWall.userData.dragMin,
      draggedWall.userData.dragMax
    );
    draggedWall.position.copy(rest).addScaledVector(axis, offset);
  }
});

window.addEventListener("pointerup", () => {
  draggedWall = null;
  controls.enabled = true;
});

// --- nametag characters ---
const labelsLayer = document.getElementById("labels");
const nameInput = document.getElementById("nameInput");
const characters = [];
let spawnCount = 0;

function spawnCharacter(name) {
  const hue = Math.random();
  const color = new THREE.Color().setHSL(hue, 0.6, 0.55);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.9, 0.5),
    new THREE.MeshStandardMaterial({ color })
  );
  const row = Math.floor(spawnCount / 6);
  const col = spawnCount % 6;
  mesh.position.set(-6 + col * 2.2, 0.45, half + 4 + row * 2.2);
  scene.add(mesh);

  const el = document.createElement("div");
  el.className = "nametag";
  el.textContent = name;
  labelsLayer.appendChild(el);

  characters.push({ mesh, el });
  spawnCount++;
}

nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && nameInput.value.trim()) {
    spawnCharacter(nameInput.value.trim());
    nameInput.value = "";
  }
});

const projected = new THREE.Vector3();
function updateLabels() {
  characters.forEach(({ mesh, el }) => {
    projected.copy(mesh.position);
    projected.y += 0.7;
    projected.project(camera);
    if (projected.z > 1) {
      el.style.display = "none";
      return;
    }
    el.style.display = "block";
    el.style.left = `${(projected.x * 0.5 + 0.5) * window.innerWidth}px`;
    el.style.top = `${(-projected.y * 0.5 + 0.5) * window.innerHeight}px`;
  });
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  const t = 0.08;
  pivotWest.rotation.x = THREE.MathUtils.lerp(pivotWest.rotation.x, roofOpen ? OPEN_WEST : CLOSED_WEST, t);
  pivotEast.rotation.x = THREE.MathUtils.lerp(pivotEast.rotation.x, roofOpen ? OPEN_EAST : CLOSED_EAST, t);
  controls.update();
  updateLabels();
  renderer.render(scene, camera);
}
animate();
