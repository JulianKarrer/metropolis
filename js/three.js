import * as THREE from './three.module.js';
import { GLTFLoader } from './GLTFLoader.js';
import { LineMaterial } from './LineMaterial.js';
import { LineGeometry } from './LineGeometry.js';
import { Line2 } from './Line2.js';

const MAX_SEGMENTS = 5
const STEPS = 1000
const DRAW_EVERY = 10
const BIG_P = 0.05
const SMALL_STEP = 0.001
const FIRST_ON_LIGHT = false
const DIM_OPACITY = 0.3

// use a PRNG
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// const rand = mulberry32(42069_6);
const rand = mulberry32(42069_10);

const vm = Math.min(window.innerHeight, window.innerWidth)
const [w_three, h_three] = [0.9*vm, 0.9*vm]

// setup renderer, camera etc
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, w_three / h_three, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({
  alpha:true,
  antialias:true
});
renderer.setSize(w_three, h_three);
renderer.setPixelRatio( window.devicePixelRatio );
renderer.setAnimationLoop(animate);
document.getElementById("three-canv").appendChild(renderer.domElement);

// setup scene
const box_size = 10;
const bs = box_size/2;
const geometry = new THREE.BoxGeometry(box_size, box_size, box_size);
const material = new THREE.MeshStandardMaterial({ 
  color: 0xffffff, 
  side: THREE.DoubleSide, 
  transparent: true, 
  opacity: 0.3,
  roughness: 0.5,
  metalness: 0.5,
});
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// setup lights
const lightplane_size = bs / 2;
const intensity = 30;
const rectLight = new THREE.RectAreaLight(0xffffff, intensity, lightplane_size, lightplane_size);
rectLight.position.set(0, bs - 0.00011, 0);
rectLight.lookAt(0, 0, 0);
scene.add(rectLight);

const light_plane_geo = new THREE.PlaneGeometry(1, 1);
const light_plane_mat = new THREE.MeshStandardMaterial({ emissive: 0xffffff, color: 0xffffff, side: THREE.DoubleSide });
const plane = new THREE.Mesh(light_plane_geo, light_plane_mat);
plane.rotation.x = Math.PI / 2;
plane.scale.x = lightplane_size;
plane.scale.y = lightplane_size;
plane.position.set(0, bs - 0.0001, 0);
scene.add(plane);

const light = new THREE.AmbientLight(0x404040); // soft white light
scene.add(light);

// load 3d model
const cam_pos = [0,0,bs]
const gltfLoader = new GLTFLoader();
gltfLoader.load(
  '/metropolis/models/camera_shifted.glb',
  function (gltf) {
    const model = gltf.scene;
    model.position.set(cam_pos[0],cam_pos[1],cam_pos[2]);
    // model.scale.set(1, 1, 1);
    scene.add(model);
  },
  function (xhr) {
    // console.log((xhr.loaded / xhr.total * 100) + '% loaded');
  },
  function (error) {
    console.error('An error occurred loading the GLB model:', error);
  }
);

function hslToHex(x, s=100, l=50) {
  // https://stackoverflow.com/questions/36721830/convert-hsl-to-rgb-and-hex
  l /= 100;
  const h = x*360
  const a = s * Math.min(l, 1 - l) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0'); 
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// draw paths
// function addPathToScene(points, col) {
//   const vertices = new Float32Array(points.flat());
//   const geometry = new THREE.BufferGeometry();
//   geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
//   const material = new THREE.LineBasicMaterial({ 
//     color: col,
//   });
//   const line = new THREE.Line(geometry, material);
//   scene.add(line);
//   return line
// }
function addPathToScene(points, col) {
  const positions = points.flat();
  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({
    color: col,
    linewidth: 1, 
    dashed: false,
    alphaToCoverage: true, // for transparency
    opacity: 1,
  });
  const line = new Line2(geometry, material);
  // line.computeLineDistances();
  scene.add(line);
  return line;
}

// pathtrace
function cross(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0]
  ];
}
function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 0 ? [v[0]/len, v[1]/len, v[2]/len] : [0,0,0];
}
function dot(a,b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function negate(v) { return [-v[0], -v[1], -v[2]]; }
function intersectBox(pos, dir, boxMin, boxMax) {
  let tmin = -Infinity, tmax = Infinity;
  let hitNormal = [0, 0, 0];

  for (let i = 0; i < 3; i++) {
    const invD = 1 / dir[i];
    let t1 = (boxMin[i] - pos[i]) * invD;
    let t2 = (boxMax[i] - pos[i]) * invD;

    let normal = [0, 0, 0];
    normal[i] = invD < 0 ? 1 : -1;

    if (t1 > t2) [t1, t2] = [t2, t1];

    if (t1 > tmin) {
      tmin = t1;
      hitNormal = normal;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return { t: Infinity, normal: [0, 0, 0] };
  }
  return { t: tmin, normal: hitNormal };
}

function cosineSampleHemisphere(u1, u2, normal) {
  // Sample in local coords
  const r = Math.sqrt(u1);
  const theta = 2 * Math.PI * u2;

  const x = r * Math.cos(theta);
  const y = r * Math.sin(theta);
  const z = Math.sqrt(Math.max(0, 1 - u1)); // cosine-weighted

  // Orthonormal basis (TBN)
  const up = Math.abs(normal[1]) < 0.999 ? [0, 1, 0] : [1, 0, 0];
  const tangent = normalize(cross(up, normal));
  const bitangent = cross(normal, tangent);

  return normalize([
    tangent[0] * x + bitangent[0] * y + normal[0] * z,
    tangent[1] * x + bitangent[1] * y + normal[1] * z,
    tangent[2] * x + bitangent[2] * y + normal[2] * z
  ]);
}

const onLight = point => {
  const epsilon = 1e-4;
  const lightY = bs;
  const lightHalfSize = bs / 4;
  return (
    Math.abs(point[1] - lightY) < epsilon &&
    Math.abs(point[0]) <= lightHalfSize &&
    Math.abs(point[2]) <= lightHalfSize
  );
}
function computePathRadiance(path, boxSize = box_size, albedo = 0.8, Le = 1.0) {
  let throughput = 1.0;

  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const curr = path[i];

    // direction from prev→curr
    const dir = normalize([
      curr[0] - prev[0],
      curr[1] - prev[1],
      curr[2] - prev[2],
    ]);

    // If this vertex is on the light – return emitted Le * cosθ * throughput
    if (onLight(curr)) {
      // light faces “downward” in –Y
      const lightNormal = [0, -1, 0];
      const cosTheta = Math.abs(dot(lightNormal, negate(dir)));
      return throughput * cosTheta * Le;
    }

    // Lambertian BRDF = albedo/π, PDF (cosine‐weighted) = cosIn/π
    // so (BRDF * cosIn) / PDF = (albedo/π * cosIn) / (cosIn/π) = albedo
    throughput *= albedo;
  }

  // no light was ever hit along the path
  return 0;
}



function generateCosineBouncedPath(
  randomArray,
  startPoint=cam_pos,
  startDirection=[0,0,1],
  segments=MAX_SEGMENTS,
  boxSize=box_size
) {
  const points = [startPoint.slice()];
  let dir = normalize(startDirection);
  let pos = startPoint.slice();
  const boxMin = [-boxSize / 2, -boxSize / 2, -boxSize / 2];
  const boxMax = [ boxSize / 2,  boxSize / 2,  boxSize / 2];

  let randIndex = 0;

  for (let i = 0; i < segments; i++) {
    // Compute intersection with box
    const { t, normal } = intersectBox(pos, dir, boxMin, boxMax);
    if (t === Infinity) break;

    // Move to intersection point
    pos = [
      pos[0] + dir[0] * t,
      pos[1] + dir[1] * t,
      pos[2] + dir[2] * t
    ];
    points.push(pos.slice());

    if (onLight(pos)){
      return points;
    }

    // Cosine-weighted bounce in hemisphere around the surface normal
    const rand1 = randomArray[randIndex++ % randomArray.length];
    const rand2 = randomArray[randIndex++ % randomArray.length];
    dir = cosineSampleHemisphere(rand1, rand2, normal);
  }

  return points;
}

function getRands(){
  return Array.from({length: MAX_SEGMENTS*2}, () => rand())
};

// metropolis sampling
function metropolis_sample_path(rands, path, bigstep_p, stepsize){
  // make a proposal
  let px = []
  if (rand() < bigstep_p){
    // global step
    px = getRands()
  } else {
    // local step
    // https://bjlkeng.io/posts/sampling-from-a-normal-distribution/
    px = rands.map(x=>{
      let fact = Math.sqrt(-2*Math.log(rand()))
      let inner = 2.*Math.PI*rand()
      let X = fact * Math.cos(inner)
      return periodic(x + X * stepsize)
    })
  }
  // if the proposal is accepted, return
  const new_path = generateCosineBouncedPath(px)
  let path_rad = computePathRadiance(path)
  // also accept jump in case 0/0
  let alpha = path_rad < 1e-8 ? 1 : computePathRadiance(new_path)/path_rad
  if (rand() <= alpha ){
    return [px, new_path]
  } else {
    return [rands, path]
  }
}

let rands = getRands()
let path = generateCosineBouncedPath(rands)
// ensure initial path is light-carrying
if (FIRST_ON_LIGHT){
  while(true){
    rands = getRands()
    path = generateCosineBouncedPath(rands)
    if (computePathRadiance(path)>=1e-8){
      break
    }
  }
}

let all_paths = []
for(let i=0; i<STEPS; i++){
  if (i%DRAW_EVERY===0){
    let colour = hslToHex(i/STEPS/2+0.5)
    let line = addPathToScene(path, colour);
    all_paths.push({
      randoms: rands.slice(), 
      line: line, 
      radiance: computePathRadiance(path),
      colour: colour,
      percentage: i/STEPS,
    })
  }
  [rands, path] = metropolis_sample_path(rands, path, BIG_P, SMALL_STEP)
  // console.log(computePathRadiance(path))
}

// Orbit control
let isMouseDown = false;
let mouse = { x: 0, y: 0 };
let rotation = { x: 0, y: 0 };
let targetRotation = { x: 0, y: -Math.PI/4 };
let radius = 15;
const minRadius = 2;
const maxRadius = 100;
renderer.domElement.addEventListener('mousedown', (event) => {
  isMouseDown = true;
  mouse.x = event.clientX;
  mouse.y = event.clientY;
});
renderer.domElement.addEventListener('mouseup', () => {
  isMouseDown = false;
  rotation.x = targetRotation.x;
  rotation.y = targetRotation.y;
});
renderer.domElement.addEventListener('mousemove', (event) => {
  if (isMouseDown) {
    const deltaX = event.clientX - mouse.x;
    const deltaY = event.clientY - mouse.y;
    targetRotation.y = rotation.y - deltaX * 0.005;
    targetRotation.x = rotation.x + deltaY * 0.005;
  }
});
renderer.domElement.addEventListener('wheel', (event) => {
  event.preventDefault();
  radius += event.deltaY * 0.01;
  radius = Math.max(minRadius, Math.min(maxRadius, radius));
}, { passive: false });

function animate() {
  // Orbit Control
  targetRotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, targetRotation.x));
  const x = radius * Math.sin(targetRotation.y) * Math.cos(targetRotation.x);
  const y = radius * Math.sin(targetRotation.x);
  const z = radius * Math.cos(targetRotation.y) * Math.cos(targetRotation.x);
  camera.position.set(x, y, z);
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}

// PSSMLT GRAPH
const canv = document.getElementById("pssmlt-graph")
const ctx = canv.getContext("2d");
canv.height = h_three
canv.width = w_three


function redraw(){
  ctx.clearRect(0, 0, w_three,h_three);
  // draw text 
  let size_pt = 20
  ctx.fillStyle = "white"
  ctx.font = String(size_pt) + "pt Degular";
  ctx.textAlign = "center"
  ctx.fillText("Primary Sample Space [0;1]", w_three/2, h_three/1.8);
  ctx.fillText("Strahldichte [0;1]", w_three/2, h_three-size_pt/2);

  // draw the radiance graph
  const height = x => (0.99-x)*h_three/2  + h_three/2
  let w = 0
  let h = height(all_paths[0].radiance)
  ctx.lineWidth = 5

  for (let p=0; p<all_paths.length; p++){
    const path = all_paths[p]
    ctx.strokeStyle = path.colour
    ctx.beginPath();
    ctx.moveTo(w, h);
    ctx.lineTo(path.percentage*w_three, height(path.radiance));
    w = path.percentage*w_three
    h = height(path.radiance)
    ctx.stroke();
  }
  ctx.lineWidth = 2

  // draw selected random numbers
  const PICK_FIRST = MAX_SEGMENTS*2
  for (let i=0; i<PICK_FIRST; i++){
    ctx.beginPath();
    ctx.strokeStyle = hslToHex(i/PICK_FIRST, 30, 50)

    for (let p=0; p<all_paths.length; p++){
      if (p>0 && Math.abs(all_paths[p-1].randoms[i] - all_paths[p].randoms[i]) >= (1.- SMALL_STEP*7.5)){
        // do nothing
        ctx.moveTo(
          all_paths[p].percentage*w_three, 
          height(all_paths[p].randoms[i]) - h_three/2
        );
      } else {
        ctx.lineTo(
          all_paths[p].percentage*w_three, 
          height(all_paths[p].randoms[i]) - h_three/2
        );
      }
      
      
    }
    ctx.stroke();

  }
}
redraw()

function highlightPath(index) {
  all_paths.forEach((pathObj, i) => {
    const line = pathObj.line;

    if (i === index) {
      // HIGHLIGHT
      line.material.opacity = 1.0;
      line.material.linewidth = 10;
    } else {
      // DIM
      line.material.opacity = DIM_OPACITY;
      line.material.linewidth = 1;
    }

    line.material.needsUpdate = true;
  });
}
function resetPathHighlights() {
  all_paths.forEach((pathObj, _) => {
    const line = pathObj.line;
    line.material.opacity = 1;
    line.material.linewidth = 1;
    line.material.needsUpdate = true;
  });
}

let canv_locked = false 
let path_selected = 0
canv.onclick = (_)=>{canv_locked = !canv_locked}
canv.onpointerleave = (_)=>{if (!canv_locked) {resetPathHighlights()}}
canv.onpointermove = (e)=>{
  const rect = canv.getBoundingClientRect();
  path_selected = Math.floor(((e.clientX - rect.left) / rect.width) * all_paths.length);
  highlightPath(path_selected)
}

