import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as dat from 'dat.gui';

// --- Basic Scene Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// --- Ground Plane ---
const groundGeometry = new THREE.PlaneGeometry(20, 20);
const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.8,
    metalness: 0.2
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2; // Rotate to be horizontal
scene.add(ground);

// --- Audio Context Setup ---
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let soundEnabled = true;
const soundGainNode = audioContext.createGain();
soundGainNode.gain.value = 0.5;
soundGainNode.connect(audioContext.destination);

function playElectricSound(intensity) {
    if (!soundEnabled) return;
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = 100 + Math.random() * 5000 * intensity;
    gainNode.gain.value = 0.1 * intensity;
    
    oscillator.connect(gainNode);
    gainNode.connect(soundGainNode);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.1);
    
    // Add a filter for more electric sound
    const filter = audioContext.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 500;
    gainNode.connect(filter);
    filter.connect(soundGainNode);
}

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0x404040, 1); // Soft white light
scene.add(ambientLight);
const pointLight = new THREE.PointLight(0xffffff, 2, 100); // Light near the top
pointLight.position.set(0, 5, 2);
scene.add(pointLight);

// --- Camera Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // Smooth camera movement
controls.dampingFactor = 0.05;
camera.position.set(0, 5, 15); // Initial camera position
controls.update();

// --- Tesla Coil Model ---
const coilGroup = new THREE.Group();
scene.add(coilGroup);

// Materials
const metalMaterial = new THREE.MeshStandardMaterial({
    color: 0x808080, // Grey metal
    metalness: 0.8,
    roughness: 0.3
});
const copperMaterial = new THREE.MeshStandardMaterial({
    color: 0xb87333, // Copper color
    metalness: 0.9,
    roughness: 0.4
});

// Geometry
const primaryRadius = 2;
const primaryHeight = 0.5;
const primarySegments = 32;
const primaryCoilGeo = new THREE.CylinderGeometry(primaryRadius, primaryRadius, primaryHeight, primarySegments);
const primaryCoil = new THREE.Mesh(primaryCoilGeo, copperMaterial);
primaryCoil.position.y = primaryHeight / 2; // Sit on the ground plane
coilGroup.add(primaryCoil);

const secondaryRadius = 0.5;
const secondaryHeight = 5;
const secondarySegments = 32;
const secondaryCoilGeo = new THREE.CylinderGeometry(secondaryRadius, secondaryRadius, secondaryHeight, secondarySegments);
const secondaryCoil = new THREE.Mesh(secondaryCoilGeo, copperMaterial);
secondaryCoil.position.y = primaryHeight + secondaryHeight / 2; // Stack on primary
coilGroup.add(secondaryCoil);

const toroidRadius = 1.5;
const toroidTubeRadius = 0.4;
const toroidRadialSegments = 16;
const toroidTubularSegments = 32;
const toroidGeo = new THREE.TorusGeometry(toroidRadius, toroidTubeRadius, toroidRadialSegments, toroidTubularSegments);
const toroid = new THREE.Mesh(toroidGeo, metalMaterial);
toroid.position.y = primaryHeight + secondaryHeight + toroidTubeRadius / 2; // Sit on top of secondary
toroid.rotation.x = Math.PI / 2; // Orient torus horizontally
coilGroup.add(toroid);

// Store toroid's world position for arc generation
const toroidWorldPosition = new THREE.Vector3();
toroid.getWorldPosition(toroidWorldPosition); // Get initial position

// --- Spark Particle System ---
const MAX_SPARKS = 500;
const sparkPositions = new Float32Array(MAX_SPARKS * 3);
const sparkVelocities = new Float32Array(MAX_SPARKS * 3);
const sparkLifetimes = new Float32Array(MAX_SPARKS);
let sparkCount = 0;

const sparkParticles = new THREE.BufferGeometry();
sparkParticles.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
const sparkMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.1,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending
});
const sparkSystem = new THREE.Points(sparkParticles, sparkMaterial);
scene.add(sparkSystem);

function createSparks(position, intensity) {
    const numSparks = Math.min(10 + Math.floor(10 * intensity), MAX_SPARKS - sparkCount);
    const color = new THREE.Color(params.arcColor);
    
    for (let i = 0; i < numSparks; i++) {
        const idx = sparkCount * 3;
        
        // Position
        sparkPositions[idx] = position.x + (Math.random() - 0.5) * 0.5;
        sparkPositions[idx+1] = position.y + (Math.random() - 0.5) * 0.5;
        sparkPositions[idx+2] = position.z + (Math.random() - 0.5) * 0.5;
        
        // Velocity
        sparkVelocities[idx] = (Math.random() - 0.5) * 0.2;
        sparkVelocities[idx+1] = Math.random() * 0.2;
        sparkVelocities[idx+2] = (Math.random() - 0.5) * 0.2;
        
        // Lifetime
        sparkLifetimes[sparkCount] = 0.5 + Math.random() * 0.5;
        
        sparkCount = (sparkCount + 1) % MAX_SPARKS;
    }
    
    sparkParticles.attributes.position.needsUpdate = true;
}

// --- Arc Simulation ---
const arcGroup = new THREE.Group();
scene.add(arcGroup);
const MAX_ARC_POINTS = 50; // Max segments per arc
const ARC_LIFETIME = 0.1; // Seconds an arc lasts
let activeArcs = []; // To manage arc objects and their lifetimes

function createArc(startPos, intensity, color) {
    const points = [startPos.clone()];
    let currentPos = startPos.clone();
    const arcLength = 2 + Math.random() * 5 * intensity; // Base length + random scaled by intensity
    const numSegments = Math.floor(10 + Math.random() * (MAX_ARC_POINTS - 10)); // Random number of segments

    // Create initial direction with downward bias (toward ground)
    const direction = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.7) * 2, // More likely to go downward
        (Math.random() - 0.5) * 2
    ).normalize();

    // Store potential branch directions
    const branchDirections = [];

    const segmentLength = arcLength / numSegments;

    for (let i = 1; i < numSegments; i++) {
        // Move in the general direction
        const nextPos = currentPos.clone().addScaledVector(direction, segmentLength);

        // Add random jitter (more jitter further from the start)
        const jitterScale = (i / numSegments) * 0.5 * intensity;
        nextPos.x += (Math.random() - 0.5) * jitterScale;
        nextPos.y += (Math.random() - 0.5) * jitterScale;
        nextPos.z += (Math.random() - 0.5) * jitterScale;

        // Occasionally create a branch (more likely with higher intensity)
        if (Math.random() < 0.05 * intensity && i < numSegments - 5) {
            const branchDir = direction.clone()
                .add(new THREE.Vector3(
                    (Math.random() - 0.5) * 0.5,
                    (Math.random() - 0.5) * 0.5,
                    (Math.random() - 0.5) * 0.5
                ))
                .normalize();
            
            let branchPos = nextPos.clone();
            const branchLength = arcLength * (0.2 + Math.random() * 0.3);
            const branchSegments = Math.floor(5 + Math.random() * 5);
            
            for (let j = 0; j < branchSegments; j++) {
                branchPos.addScaledVector(branchDir, branchLength / branchSegments);
                branchPos.x += (Math.random() - 0.5) * jitterScale * 0.5;
                branchPos.y += (Math.random() - 0.5) * jitterScale * 0.5;
                branchPos.z += (Math.random() - 0.5) * jitterScale * 0.5;
                points.push(branchPos.clone());
            }
        }

        points.push(nextPos);
        currentPos = nextPos;

        // If arc hits ground plane, create ground strike effect
        if (nextPos.y <= 0) {
            playElectricSound(intensity * 1.5); // Louder sound for ground strike
            break; // Stop arc progression
        }
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
        color: color,
        linewidth: Math.random() * 1 + 1, // Slight variation in thickness
        transparent: true,
        opacity: 0.8 // Slightly transparent
     });

    const arcLine = new THREE.Line(geometry, material);
    arcLine.userData.creationTime = performance.now() / 1000;
    arcLine.userData.endPosition = points[points.length - 1]; // Store end position
    
    // Play electric sound when arc is created
    playElectricSound(intensity);
    
    // Create initial sparks at arc start
    createSparks(startPos, intensity);
    
    return arcLine;
}


// --- GUI Controls ---
const gui = new dat.GUI();
const params = {
    intensity: 1.0,
    arcColor: '#ffffff', // White
    numArcs: 5,
    soundEnabled: true,
    dayMode: true
};

gui.add(params, 'intensity', 0.1, 5.0).name('Intensity');
gui.addColor(params, 'arcColor').name('Arc Color');
gui.add(params, 'numArcs', 1, 20, 1).name('Number of Arcs'); // Integer slider
gui.add(params, 'soundEnabled').name('Sound On/Off').onChange((val) => {
    soundEnabled = val;
});
gui.add(params, 'dayMode').name('Day/Night Mode').onChange((val) => {
    if (val) {
        // Day mode
        ambientLight.intensity = 1;
        pointLight.intensity = 2;
        ground.material.color.set(0x333333);
        renderer.setClearColor(0x000000, 1);
    } else {
        // Night mode
        ambientLight.intensity = 0.2;
        pointLight.intensity = 0.5;
        ground.material.color.set(0x111111);
        renderer.setClearColor(0x111133, 1);
    }
});

// --- Animation Loop ---
const clock = new THREE.Clock(); // Use clock for time-based logic

function animate() {
    requestAnimationFrame(animate);
    const currentTime = performance.now() / 1000; // Get time in seconds
    const deltaTime = clock.getDelta(); // Time since last frame

    controls.update(); // Required if enableDamping is true

    // Update toroid position (in case it moves - though it doesn't in this example)
    toroid.getWorldPosition(toroidWorldPosition);

    // --- Arc Management ---
    const arcsToRemove = [];
    // Update existing arcs and check lifetime
    activeArcs.forEach((arcData, index) => {
        const age = currentTime - arcData.arc.userData.creationTime;
        if (age > ARC_LIFETIME) {
            arcsToRemove.push(index);
            arcGroup.remove(arcData.arc);
            arcData.arc.geometry.dispose(); // Clean up geometry
            arcData.arc.material.dispose(); // Clean up material
        } else {
            // Update color if changed via GUI
            // Check efficiently by comparing hex strings (substring removes '#')
            if (arcData.arc.material.color.getHexString() !== params.arcColor.substring(1)) {
                 arcData.arc.material.color.set(params.arcColor);
            }
            // Optional: Fade out effect based on age
            arcData.arc.material.opacity = 0.8 * (1 - age / ARC_LIFETIME);
        }
    });

    // Remove expired arcs from the scene and our tracking array
    // Iterate backwards when removing to avoid messing up indices
    for (let i = arcsToRemove.length - 1; i >= 0; i--) {
        activeArcs.splice(arcsToRemove[i], 1);
    }

    // Create new arcs if needed, based on GUI parameters
    const desiredArcs = Math.floor(params.numArcs); // Ensure integer value
    const arcsToCreate = desiredArcs - activeArcs.length;

    // Limit creation rate slightly based on intensity and time to avoid overwhelming bursts
    // Adjust the multiplier (e.g., 50) to control spawn frequency relative to intensity
    const creationChance = params.intensity * deltaTime * 50;

    // Only create one arc per frame if needed and if the random chance passes
    if (arcsToCreate > 0 && Math.random() < creationChance) {
        const newArc = createArc(toroidWorldPosition, params.intensity, params.arcColor);
        arcGroup.add(newArc);
        activeArcs.push({ arc: newArc }); // Add to our tracking array
    }


    // Update sparks
    for (let i = 0; i < sparkCount; i++) {
        const idx = i * 3;
        sparkPositions[idx] += sparkVelocities[idx] * deltaTime;
        sparkPositions[idx+1] += sparkVelocities[idx+1] * deltaTime;
        sparkPositions[idx+2] += sparkVelocities[idx+2] * deltaTime;
        
        // Apply gravity
        sparkVelocities[idx+1] -= 0.1 * deltaTime;
        
        // Reduce lifetime
        sparkLifetimes[i] -= deltaTime;
        
        // Fade out
        if (sparkLifetimes[i] < 0.2) {
            const alpha = sparkLifetimes[i] / 0.2;
            sparkPositions[idx] = sparkPositions[idx] * alpha;
            sparkPositions[idx+1] = sparkPositions[idx+1] * alpha;
            sparkPositions[idx+2] = sparkPositions[idx+2] * alpha;
        }
    }
    sparkParticles.attributes.position.needsUpdate = true;

    renderer.render(scene, camera);
}

// --- Resize Handling ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onWindowResize);

// --- Start Animation ---
animate();