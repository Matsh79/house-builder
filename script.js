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
const staticColliders = []; // non-draggable solid boxes (house-local space), e.g. loft knee-walls

const POKE = WALL_T + 0.05; // thicker than the wall so cutouts poke through both faces

function addWindow(parent, x, y, z, w, h, axis) {
  const geo = axis === "x"
    ? new THREE.BoxGeometry(POKE, h, w)
    : new THREE.BoxGeometry(w, h, POKE);
  const win = new THREE.Mesh(geo, windowMat);
  win.position.set(x, y, z);
  parent.add(win);
}

// Splits [start,end] into the sub-ranges left over after removing each
// [a,b] gap. Used both for interior-wall doorways and for door cutouts.
function subtractGaps(start, end, gaps) {
  const sorted = gaps.slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  let cursor = start;
  sorted.forEach(([a, b]) => {
    if (a > cursor) out.push([cursor, a]);
    cursor = Math.max(cursor, b);
  });
  if (cursor < end) out.push([cursor, end]);
  return out;
}

const doors = [];

// A door that pivots open around a vertical hinge at one edge, and carves
// a passable gap into its wall's collision boxes while open.
function addDoorHinged(parent, cx, y, cz, w, h, axis) {
  const pivot = new THREE.Group();
  let doorLocalX = 0, doorLocalZ = 0, geo;
  if (axis === "x") {
    geo = new THREE.BoxGeometry(POKE, h, w);
    pivot.position.set(cx, y, cz - w / 2);
    doorLocalZ = w / 2;
  } else {
    geo = new THREE.BoxGeometry(w, h, POKE);
    pivot.position.set(cx - w / 2, y, cz);
    doorLocalX = w / 2;
  }
  parent.add(pivot);
  const door = new THREE.Mesh(geo, doorMat);
  door.position.set(doorLocalX, 0, doorLocalZ);
  pivot.add(door);

  const base = parent.userData.localBoxes[0];
  const gapA = axis === "x" ? cz - w / 2 : cx - w / 2;
  const gapB = axis === "x" ? cz + w / 2 : cx + w / 2;
  const openBoxes = (axis === "x"
    ? subtractGaps(base.min.z, base.max.z, [[gapA, gapB]])
    : subtractGaps(base.min.x, base.max.x, [[gapA, gapB]])
  ).map(([a, b]) => axis === "x"
    ? new THREE.Box3(new THREE.Vector3(base.min.x, base.min.y, a), new THREE.Vector3(base.max.x, base.max.y, b))
    : new THREE.Box3(new THREE.Vector3(a, base.min.y, base.min.z), new THREE.Vector3(b, base.max.y, base.max.z))
  );

  const rec = {
    pivot, wallGroup: parent, openBoxes,
    closedRot: 0, openRot: Math.PI / 2, isOpen: false,
    worldPos: new THREE.Vector3(),
  };
  doors.push(rec);
  return rec;
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
  group.userData.localBoxes = [new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(WALL_T, RIDGE, DEPTH))];
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
  group.userData.localBoxes = [new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(LENGTH, EAVE, WALL_T))];
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

function makeInteriorWallX(xPos, z0, z1, gaps = []) {
  const group = new THREE.Group();
  const ranges = subtractGaps(z0, z1, gaps);
  ranges.forEach(([a, b]) => {
    const len = b - a;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(INT_T, INT_H, len), interiorMat);
    wall.position.set(0, INT_H / 2, a + len / 2);
    group.add(wall);
  });
  group.position.x = xPos;
  houseGroup.add(group);
  group.userData.restPosition = group.position.clone();
  group.userData.axis = new THREE.Vector3(1, 0, 0);
  group.userData.centerY = INT_H / 2;
  group.userData.dragMin = -0.6;
  group.userData.dragMax = 0.6;
  group.userData.localBoxes = ranges.map(([a, b]) =>
    new THREE.Box3(new THREE.Vector3(0, 0, a), new THREE.Vector3(INT_T, INT_H, b)));
  draggableWalls.push(group);
  return group;
}

function makeInteriorWallZ(zPos, x0, x1, gaps = []) {
  const group = new THREE.Group();
  const ranges = subtractGaps(x0, x1, gaps);
  ranges.forEach(([a, b]) => {
    const len = b - a;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, INT_H, INT_T), interiorMat);
    wall.position.set(a + len / 2, INT_H / 2, 0);
    group.add(wall);
  });
  group.position.z = zPos;
  houseGroup.add(group);
  group.userData.restPosition = group.position.clone();
  group.userData.axis = new THREE.Vector3(0, 0, 1);
  group.userData.centerY = INT_H / 2;
  group.userData.dragMin = -0.6;
  group.userData.dragMax = 0.6;
  group.userData.localBoxes = ranges.map(([a, b]) =>
    new THREE.Box3(new THREE.Vector3(a, 0, 0), new THREE.Vector3(b, INT_H, INT_T)));
  draggableWalls.push(group);
  return group;
}

// Layout approximates the real floor plan: living/kitchen open on one end,
// 3 bedrooms across the top of the other end, hallway/entry/bath/laundry/sauna below.
// Gaps are walk-through doorways connecting each room to the next.
makeInteriorWallX(6.7, 0, DEPTH, [[3.3, 4.2]]);                      // living/kitchen | rest of house
makeInteriorWallX(10.439, 0, 3.0);                                   // bedroom 1 | bedroom 2
makeInteriorWallX(14.178, 0, 3.0);                                   // bedroom 2 | bedroom 3
makeInteriorWallZ(3.0, 6.7, LENGTH, [[8.1, 9.0], [11.85, 12.75], [15.6, 16.5]]); // bedrooms | hallway
makeInteriorWallZ(4.5, 6.7, LENGTH, [[7.5, 8.4]]);                   // hallway | entry/bath/laundry wing
makeInteriorWallX(9.2, 4.5, DEPTH, [[5.0, 5.8]]);                    // entry | entry-extension/bathrooms
makeInteriorWallZ(6.0, 9.2, 13.3, [[9.9, 10.7]]);                    // entry-extension | bathroom 1
makeInteriorWallX(11.0, 6.0, DEPTH, [[6.8, 7.6]]);                   // bathroom 1 | bathroom 2
makeInteriorWallX(13.3, 4.5, DEPTH, [[4.9, 5.7]]);                   // bathroom 2/entry-ext | laundry
makeInteriorWallX(15.5, 4.5, 6.0, [[4.9, 5.6]]);                     // laundry | sauna
makeInteriorWallZ(6.0, 15.5, LENGTH);                                // sauna | laundry (lower edge)

// windows/doors (approximate, matching the facade drawings)
// parented to the wall GROUP (not the mesh) so coordinates are in the
// group's own local space and line up with the wall itself
addWindow(wallWest, 2.5, 1.6, 0, 1.0, 1.1, "z");
addWindow(wallWest, 4.2, 1.6, 0, 1.0, 1.1, "z");
addWindow(wallWest, 5.9, 1.6, 0, 1.0, 1.1, "z");
addWindow(wallWest, 8.5, 1.7, 0, 1.6, 1.6, "z");
addWindow(wallWest, 11, 1.7, 0, 1.8, 1.8, "z");
addWindow(wallWest, 14, 1.7, 0, 1.8, 1.8, "z");

addDoorHinged(wallEast, 3.2, 1.05, 0, 1.6, 2.1, "z");
addWindow(wallEast, 1.2, 1.6, 0, 0.9, 1.0, "z");
addWindow(wallEast, 6, 1.6, 0, 0.9, 1.0, "z");

addDoorHinged(gableSouth, 0, 1.05, 3.5, 1.6, 2.1, "x");
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

// --- second floor / loft ("hems", from plan A.02) ---
// The loft floor sits above the bedroom/bathroom wing. Its enclosed room
// uses short knee-walls (not full height) so they stay under the sloped
// roof instead of poking through it near the eaves.
const LOFT_Y = EAVE;
const HEMS_H = 0.6;

// stairs up from the entry room (10 risers, stacked-block style)
const STAIR_X0 = 6.85, STAIR_STEPS = 10, STAIR_RUN = 2.3, STAIR_Z = 6.0, STAIR_W = 0.9;
for (let i = 0; i < STAIR_STEPS; i++) {
  const stepW = STAIR_RUN / STAIR_STEPS;
  const h = ((i + 1) / STAIR_STEPS) * LOFT_Y;
  furn(stepW, h, STAIR_W, STAIR_X0 + stepW * (i + 0.5), h / 2, STAIR_Z, 0x9c7a52);
}

// loft floor platform (sits right at the eave line, so it never clips the roof)
furn(17.7 - 9.4, 0.1, 7.98 - 0.3, (9.4 + 17.7) / 2, LOFT_Y - 0.05, (0.3 + 7.98) / 2, 0xdccba3);

// enclosed hems room + a reading nook, matching the small room on the real plan
function loftWallX(xPos, z0, z1) {
  furn(INT_T, HEMS_H, z1 - z0, xPos, LOFT_Y + HEMS_H / 2, (z0 + z1) / 2, 0xf0ead9);
  staticColliders.push(new THREE.Box3(
    new THREE.Vector3(xPos - INT_T / 2, LOFT_Y, z0),
    new THREE.Vector3(xPos + INT_T / 2, LOFT_Y + HEMS_H, z1)
  ));
}
function loftWallZ(zPos, x0, x1) {
  furn(x1 - x0, HEMS_H, INT_T, (x0 + x1) / 2, LOFT_Y + HEMS_H / 2, zPos, 0xf0ead9);
  staticColliders.push(new THREE.Box3(
    new THREE.Vector3(x0, LOFT_Y, zPos - INT_T / 2),
    new THREE.Vector3(x1, LOFT_Y + HEMS_H, zPos + INT_T / 2)
  ));
}
loftWallZ(2.3, 13.0, 17.2);  // hems room front knee-wall
loftWallZ(6.0, 13.0, 17.2);  // hems room back knee-wall
loftWallX(17.2, 2.3, 6.0);   // hems room end knee-wall (near the gable window)
loftWallX(15.1, 2.3, 6.0);   // internal divider (room | nook)
furn(1.3, 0.3, 1.8, 16.1, LOFT_Y + 0.15, 4.1, 0xc9a6db);  // loft bed
furn(0.5, 0.5, 0.5, 14.0, LOFT_Y + 0.25, 4.6, 0x7a5c46);  // reading chair
furn(0.4, 0.35, 0.4, 14.0, LOFT_Y + 0.175, 3.7, 0x9c7a52); // side table

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
  if (c.isMesh) {
    c.userData.wallRoot = w;
    wallMeshes.push(c);
  }
}));

renderer.domElement.addEventListener("pointerdown", (e) => {
  if (fpsMode) return;
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

// --- first-person walk mode ---
const EYE_HEIGHT = 1.6;
const PLAYER_R = 0.25;
const MOVE_SPEED = 3.2;
const DOOR_REACH = 2.2;
const defaultOrbitPos = new THREE.Vector3(18, 11, 22);
const defaultOrbitTarget = new THREE.Vector3(0, EAVE, 0);
const defaultHint = "Drag a wall to pull it out. Drag to orbit, scroll to zoom.";
const walkHint = "WASD to move, mouse to look, E to open doors, Esc to leave.";

let fpsMode = false;
let playerPos = new THREE.Vector3(3, 0, 4); // starts in the living room, house-local coords
let playerFeetY = 0;
let yaw = Math.PI, camPitch = 0;
const keys = {};
const clock = new THREE.Clock();

const walkBtn = document.getElementById("walkBtn");
const hudHint = document.querySelector("#hud .hint");
const crosshair = document.getElementById("crosshair");
const doorHint = document.getElementById("doorHint");

function getCollidableBoxes() {
  const boxes = staticColliders.slice();
  draggableWalls.forEach(w => {
    const door = doors.find(d => d.wallGroup === w);
    const localBoxes = door && door.isOpen ? door.openBoxes : w.userData.localBoxes;
    localBoxes.forEach(b => boxes.push(b.clone().translate(w.position)));
  });
  return boxes;
}

function collides(x, z, feetY) {
  const px0 = x - PLAYER_R, px1 = x + PLAYER_R;
  const pz0 = z - PLAYER_R, pz1 = z + PLAYER_R;
  const boxes = getCollidableBoxes();
  for (const box of boxes) {
    if (feetY < box.min.y - 0.05 || feetY > box.max.y + 0.05) continue;
    if (px1 > box.min.x && px0 < box.max.x && pz1 > box.min.z && pz0 < box.max.z) return true;
  }
  return false;
}

function updatePlayerFeetY() {
  const inStairX = playerPos.x >= STAIR_X0 && playerPos.x <= STAIR_X0 + STAIR_RUN;
  const inStairZ = Math.abs(playerPos.z - STAIR_Z) <= STAIR_W / 2;
  if (inStairX && inStairZ) {
    const t = (playerPos.x - STAIR_X0) / STAIR_RUN;
    playerFeetY = THREE.MathUtils.clamp(t, 0, 1) * LOFT_Y;
  } else {
    playerFeetY = playerFeetY > LOFT_Y / 2 ? LOFT_Y : 0;
  }
}

function tryMove(dx, dz) {
  const newX = playerPos.x + dx;
  if (!collides(newX, playerPos.z, playerFeetY)) playerPos.x = newX;
  const newZ = playerPos.z + dz;
  if (!collides(playerPos.x, newZ, playerFeetY)) playerPos.z = newZ;
}

function nearestDoor() {
  const eyePos = camera.position;
  let closest = null, closestDist = DOOR_REACH;
  doors.forEach(d => {
    d.pivot.getWorldPosition(d.worldPos);
    const dist = d.worldPos.distanceTo(eyePos);
    if (dist < closestDist) {
      closestDist = dist;
      closest = d;
    }
  });
  return closest;
}

function enterFPS() {
  fpsMode = true;
  controls.enabled = false;
  walkBtn.textContent = "Leave Walk Mode";
  hudHint.textContent = walkHint;
  crosshair.style.display = "block";
  renderer.domElement.requestPointerLock();
}

function exitFPS() {
  fpsMode = false;
  controls.enabled = true;
  walkBtn.textContent = "Walk Inside";
  hudHint.textContent = defaultHint;
  crosshair.style.display = "none";
  doorHint.style.display = "none";
  if (document.pointerLockElement) document.exitPointerLock();
  camera.rotation.order = "XYZ";
  camera.position.copy(defaultOrbitPos);
  controls.target.copy(defaultOrbitTarget);
}

walkBtn.addEventListener("click", () => {
  if (fpsMode) exitFPS(); else enterFPS();
});

// Only treat "lock lost" as an exit if we actually had the lock before -
// a failed lock *request* (blocked, or transient browser refusal) also
// fires this event with a null element, and shouldn't kick the player
// straight back out of walk mode (keyboard movement still works either way).
let hadPointerLock = false;
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement) {
    hadPointerLock = true;
  } else if (hadPointerLock && fpsMode) {
    hadPointerLock = false;
    exitFPS();
  }
});

window.addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (fpsMode && e.code === "KeyE") {
    const d = nearestDoor();
    if (d) d.isOpen = !d.isOpen;
  }
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });

document.addEventListener("mousemove", (e) => {
  if (!fpsMode || !document.pointerLockElement) return;
  yaw -= e.movementX * 0.0022;
  camPitch = THREE.MathUtils.clamp(camPitch - e.movementY * 0.0022, -1.3, 1.3);
});

function updateFPS(dt) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  let dx = 0, dz = 0;
  if (keys.KeyW) { dx += fx; dz += fz; }
  if (keys.KeyS) { dx -= fx; dz -= fz; }
  if (keys.KeyD) { dx += rx; dz += rz; }
  if (keys.KeyA) { dx -= rx; dz -= rz; }
  const len = Math.hypot(dx, dz);
  if (len > 0.001) {
    tryMove((dx / len) * MOVE_SPEED * dt, (dz / len) * MOVE_SPEED * dt);
  }
  updatePlayerFeetY();

  camera.rotation.order = "YXZ";
  camera.rotation.y = yaw;
  camera.rotation.x = camPitch;
  camera.position.set(
    playerPos.x + houseGroup.position.x,
    playerFeetY + EYE_HEIGHT,
    playerPos.z + houseGroup.position.z
  );

  const d = nearestDoor();
  doorHint.style.display = d ? "block" : "none";
}

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = 0.08;
  pivotWest.rotation.x = THREE.MathUtils.lerp(pivotWest.rotation.x, roofOpen ? OPEN_WEST : CLOSED_WEST, t);
  pivotEast.rotation.x = THREE.MathUtils.lerp(pivotEast.rotation.x, roofOpen ? OPEN_EAST : CLOSED_EAST, t);
  doors.forEach(d => {
    d.pivot.rotation.y = THREE.MathUtils.lerp(d.pivot.rotation.y, d.isOpen ? d.openRot : d.closedRot, 0.15);
  });
  if (fpsMode) {
    updateFPS(dt);
  } else {
    controls.update();
  }
  updateLabels();
  renderer.render(scene, camera);
}
animate();
