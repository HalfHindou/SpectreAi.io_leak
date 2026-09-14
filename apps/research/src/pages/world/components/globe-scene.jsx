/**
 * GlobeScene — 3D globe with interactive layers, market beams, and live data.
 *
 * KEY FIXES:
 * - All 3 textures preloaded at mount (no remount on day/night toggle)
 * - All effects made dramatically visible (not subtle)
 * - Whale alerts received as prop from ReactDOM (not generated in R3F)
 */
import { useRef, useMemo, useState, useCallback, Suspense } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Stars, useTexture, Line } from '@react-three/drei'
import * as THREE from 'three'
import {
  GLOBE_RADIUS, latLngToVec3, FINANCIAL_HUBS, CRYPTO_NODES,
  FLOW_ROUTES, ASSET_COLORS, EARTH_TEXTURES, COUNTRY_REGIONS,
  MARKET_SESSIONS, isSessionOpen,
} from './world-constants'

/* ═══════════════════════════════════════════════
   EARTH — preloads ALL textures, swaps instantly
   No remount needed for day/night toggle.
   ═══════════════════════════════════════════════ */
function Earth({ onCountryClick, globeMode }) {
  const earthRef = useRef()

  // Load all 3 textures once at mount — swapping is instant
  const [dayTex, darkTex, nightTex] = useTexture([
    EARTH_TEXTURES.blue,
    EARTH_TEXTURES.dark,
    EARTH_TEXTURES.night,
  ])

  const mainTex = globeMode === 'day' ? dayTex : darkTex

  useFrame((_, delta) => {
    if (earthRef.current) earthRef.current.rotation.y += delta * 0.018
  })

  const handleClick = useCallback((e) => {
    e.stopPropagation()
    if (!e.point || !earthRef.current) return
    const localPoint = earthRef.current.worldToLocal(e.point.clone())
    const r = localPoint.length()
    const lat = 90 - (Math.acos(localPoint.y / r) * 180) / Math.PI
    const lng = (Math.atan2(localPoint.z, -localPoint.x) * 180) / Math.PI - 180
    let nearest = null, minDist = Infinity
    COUNTRY_REGIONS.forEach(c => {
      const d = Math.sqrt((c.lat - lat) ** 2 + (c.lng - lng) ** 2)
      if (d < minDist && d < 20) { minDist = d; nearest = c }
    })
    if (nearest) onCountryClick?.(nearest)
  }, [onCountryClick])

  return (
    <mesh ref={earthRef} onClick={handleClick}>
      <sphereGeometry args={[GLOBE_RADIUS, 96, 96]} />
      <meshStandardMaterial
        map={mainTex}
        emissiveMap={globeMode === 'day' ? null : nightTex}
        emissive={globeMode === 'day' ? new THREE.Color(0x000000) : new THREE.Color(0xffcc77)}
        emissiveIntensity={globeMode === 'day' ? 0 : 2}
        roughness={globeMode === 'day' ? 0.6 : 0.85}
        metalness={0.05}
      />
    </mesh>
  )
}

/* ═══════════════════════════════════════════════
   COUNTRY HIGHLIGHT — LARGE pulsing marker
   ═══════════════════════════════════════════════ */
function CountryHighlight({ country }) {
  const pos = useMemo(() => latLngToVec3(country.lat, country.lng, GLOBE_RADIUS + 0.03), [country])
  const ringRef = useRef()
  const ring2Ref = useRef()

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (ringRef.current) {
      const s = 1 + Math.sin(t * 3) * 0.3
      ringRef.current.scale.set(s, s, 1)
      ringRef.current.material.opacity = 0.6 + Math.sin(t * 3) * 0.2
    }
    if (ring2Ref.current) {
      const s = 1.4 + Math.sin(t * 2) * 0.4
      ring2Ref.current.scale.set(s, s, 1)
      ring2Ref.current.material.opacity = 0.3 * (1 - Math.sin(t * 2) * 0.4)
    }
  })

  return (
    <group position={pos}>
      <mesh>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh ref={ringRef}>
        <ringGeometry args={[0.09, 0.12, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring2Ref}>
        <ringGeometry args={[0.15, 0.18, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.005, 0.005, 0.6, 8]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.5} />
      </mesh>
    </group>
  )
}

/* ═══════════════════════════════════════════════
   CAPITAL FLOW ARCS — THICK, bright, obvious
   ═══════════════════════════════════════════════ */
function FlowArc({ from, to, color, speed, thickness }) {
  const curve = useMemo(() => {
    const start = latLngToVec3(from.lat, from.lng, GLOBE_RADIUS + 0.01)
    const end = latLngToVec3(to.lat, to.lng, GLOBE_RADIUS + 0.01)
    const mid = start.clone().add(end).multiplyScalar(0.5)
    mid.normalize().multiplyScalar(GLOBE_RADIUS + start.distanceTo(end) * 0.35)
    return new THREE.QuadraticBezierCurve3(start, mid, end)
  }, [from, to])

  const pts = useMemo(() => curve.getPoints(50), [curve])
  const dotRef = useRef()

  useFrame(({ clock }) => {
    const t = (clock.elapsedTime * speed * 0.12) % 1
    if (dotRef.current) dotRef.current.position.copy(curve.getPoint(t))
  })

  return (
    <group>
      <Line points={pts} color={color} lineWidth={thickness} transparent opacity={0.7} />
      <mesh ref={dotRef}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  )
}

function CapitalFlowsLayer() {
  const hubMap = useMemo(() => {
    const m = {}
    FINANCIAL_HUBS.forEach(h => { m[h.id] = h })
    return m
  }, [])

  return (
    <group>
      {FLOW_ROUTES.map((route, i) => {
        const f = hubMap[route.from], t = hubMap[route.to]
        if (!f || !t) return null
        return <FlowArc key={i} from={f} to={t} color={ASSET_COLORS[route.asset]} speed={0.4 + route.volume * 0.6} thickness={1.2 + route.volume * 1.8} />
      })}
      {FINANCIAL_HUBS.map(hub => (
        <mesh key={hub.id} position={latLngToVec3(hub.lat, hub.lng, GLOBE_RADIUS + 0.012)}>
          <sphereGeometry args={[0.03, 10, 10]} />
          <meshBasicMaterial color="#f5f5f7" />
        </mesh>
      ))}
    </group>
  )
}

/* ═══════════════════════════════════════════════
   CRYPTO NODES — LARGE pulsing circles
   ═══════════════════════════════════════════════ */
function CryptoNode({ node }) {
  const pos = useMemo(() => latLngToVec3(node.lat, node.lng, GLOBE_RADIUS + 0.015), [node])
  const r1 = useRef(), r2 = useRef()
  const sz = 0.04 + node.size * 0.06

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (r1.current) {
      const s = 1 + Math.sin(t * 2.5) * 0.5
      r1.current.scale.set(s, s, 1)
      r1.current.material.opacity = 0.7 * (1 - Math.sin(t * 2.5) * 0.4)
    }
    if (r2.current) {
      const s = 1.4 + Math.sin(t * 1.8 + 1) * 0.6
      r2.current.scale.set(s, s, 1)
      r2.current.material.opacity = 0.35 * (1 - Math.sin(t * 1.8 + 1) * 0.4)
    }
  })

  return (
    <group position={pos}>
      <mesh><sphereGeometry args={[sz, 12, 12]} /><meshBasicMaterial color="#f59e0b" /></mesh>
      <mesh ref={r1}><ringGeometry args={[sz * 1.8, sz * 2.5, 32]} /><meshBasicMaterial color="#f59e0b" transparent opacity={0.6} side={THREE.DoubleSide} /></mesh>
      <mesh ref={r2}><ringGeometry args={[sz * 3, sz * 4, 32]} /><meshBasicMaterial color="#f59e0b" transparent opacity={0.25} side={THREE.DoubleSide} /></mesh>
    </group>
  )
}

function CryptoNodesLayer() {
  return <group>{CRYPTO_NODES.map(n => <CryptoNode key={n.id} node={n} />)}</group>
}

/* ═══════════════════════════════════════════════
   WHALE ALERTS — expanding ripples, self-managing
   ═══════════════════════════════════════════════ */
function WhaleRipple({ alert }) {
  const pos = useMemo(() => latLngToVec3(alert.lat, alert.lng, GLOBE_RADIUS + 0.02), [alert])
  const r1 = useRef(), r2 = useRef(), r3 = useRef()
  const born = useRef(null)
  const [alive, setAlive] = useState(true)

  useFrame(({ clock }) => {
    if (!alive) return
    if (born.current === null) born.current = clock.elapsedTime
    const age = clock.elapsedTime - born.current
    if (age > 4) { setAlive(false); return }
    ;[r1, r2, r3].forEach((ref, i) => {
      if (!ref.current) return
      const t = Math.max(0, (age - i * 0.25) / 3)
      ref.current.scale.setScalar(1 + t * 6)
      ref.current.material.opacity = Math.max(0, 0.8 * (1 - t))
    })
  })

  if (!alive) return null

  const c = alert.token === 'BTC' || alert.token === 'ETH' ? '#a78bfa' : '#f59e0b'
  return (
    <group position={pos}>
      {[r1, r2, r3].map((ref, i) => (
        <mesh key={i} ref={ref}><ringGeometry args={[0.05, 0.07, 32]} /><meshBasicMaterial color={c} transparent opacity={0.7} side={THREE.DoubleSide} /></mesh>
      ))}
      <mesh><sphereGeometry args={[0.035, 10, 10]} /><meshBasicMaterial color={c} /></mesh>
    </group>
  )
}

function WhaleAlertsLayer({ alerts }) {
  const recent = alerts.slice(-8)
  return <group>{recent.map(a => <WhaleRipple key={a.id} alert={a} />)}</group>
}

/* ═══════════════════════════════════════════════
   SENTIMENT — LARGE colored circles, VERY visible
   ═══════════════════════════════════════════════ */
function SentimentRegion({ lat, lng, sentiment, size }) {
  const pos = useMemo(() => latLngToVec3(lat, lng, GLOBE_RADIUS + 0.008), [lat, lng])
  const ref = useRef()
  useFrame(({ clock }) => {
    if (ref.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 1.5 + lat * 0.1) * 0.2
      ref.current.scale.setScalar(s)
    }
  })
  const color = sentiment > 60 ? '#10b981' : sentiment > 40 ? '#6b7280' : '#ef4444'
  return (
    <mesh ref={ref} position={pos}>
      <circleGeometry args={[size * 0.35, 32]} />
      <meshBasicMaterial color={color} transparent opacity={0.55} side={THREE.DoubleSide} />
    </mesh>
  )
}

function SentimentLayer() {
  const regions = useMemo(() => [
    { lat: 40, lng: -95, sentiment: 68, size: 3.0 }, { lat: 50, lng: 10, sentiment: 45, size: 2.5 },
    { lat: 35, lng: 105, sentiment: 35, size: 3.0 }, { lat: 36, lng: 138, sentiment: 52, size: 1.8 },
    { lat: 20, lng: 78, sentiment: 62, size: 2.2 }, { lat: -10, lng: -55, sentiment: 40, size: 2.5 },
    { lat: 25, lng: 50, sentiment: 70, size: 1.8 }, { lat: -25, lng: 135, sentiment: 55, size: 2.0 },
    { lat: 37, lng: 127, sentiment: 58, size: 1.5 }, { lat: 62, lng: 15, sentiment: 50, size: 1.8 },
  ], [])
  return <group>{regions.map((r, i) => <SentimentRegion key={i} {...r} />)}</group>
}

/* ═══════════════════════════════════════════════
   GRID OVERLAY — CLEARLY VISIBLE white lines
   ═══════════════════════════════════════════════ */
function GridOverlay() {
  const lines = useMemo(() => {
    const result = []
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts = []
      for (let lng = -180; lng <= 180; lng += 5) {
        pts.push(latLngToVec3(lat, lng, GLOBE_RADIUS + 0.006))
      }
      result.push(pts)
    }
    for (let lng = -180; lng < 180; lng += 30) {
      const pts = []
      for (let lat = -90; lat <= 90; lat += 5) {
        pts.push(latLngToVec3(lat, lng, GLOBE_RADIUS + 0.006))
      }
      result.push(pts)
    }
    return result
  }, [])

  return (
    <group>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#f5f5f7" lineWidth={1.2} transparent opacity={0.35} />
      ))}
    </group>
  )
}

/* ═══════════════════════════════════════════════
   MARKET BEAMS — TALL bright light columns
   ═══════════════════════════════════════════════ */
const MARKET_BEAM_CONFIG = [
  { sessionId: 'asia',   lat: 35.7,  lng: 139.7,  color: '#06b6d4' },
  { sessionId: 'europe', lat: 51.5,  lng: -0.13,  color: '#3b82f6' },
  { sessionId: 'us',     lat: 40.7,  lng: -74.0,  color: '#10b981' },
]

function MarketBeam({ lat, lng, isOpen, color }) {
  const beamRef = useRef()
  const beam2Ref = useRef()
  const glowRef = useRef()
  const ring1Ref = useRef()
  const ring2Ref = useRef()

  const pos = useMemo(() => latLngToVec3(lat, lng, GLOBE_RADIUS + 0.01), [lat, lng])
  const normal = useMemo(() => pos.clone().normalize(), [pos])
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal)
    return q
  }, [normal])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime

    if (beamRef.current) {
      const pulse = isOpen ? (0.5 + Math.sin(t * 1.8) * 0.5) : 0.06
      beamRef.current.material.opacity = isOpen ? pulse * 0.3 : 0.02
    }
    if (beam2Ref.current) {
      const pulse = isOpen ? (0.4 + Math.sin(t * 2.2 + 0.5) * 0.6) : 0.04
      beam2Ref.current.material.opacity = isOpen ? pulse * 0.15 : 0.01
    }
    if (glowRef.current) {
      const pulse = isOpen ? (0.5 + Math.sin(t * 2.5) * 0.5) : 0.06
      glowRef.current.material.opacity = isOpen ? pulse * 0.8 : 0.05
    }
    if (ring1Ref.current) {
      const s = isOpen ? 1 + Math.sin(t * 3) * 0.5 : 1
      ring1Ref.current.scale.set(s, s, 1)
      ring1Ref.current.material.opacity = isOpen ? 0.5 * (0.5 + Math.sin(t * 3) * 0.5) : 0.03
    }
    if (ring2Ref.current) {
      const s = isOpen ? 1.4 + Math.sin(t * 2 + 1) * 0.6 : 1
      ring2Ref.current.scale.set(s, s, 1)
      ring2Ref.current.material.opacity = isOpen ? 0.25 : 0.02
    }
  })

  return (
    <group position={pos} quaternion={quaternion}>
      {/* Main beam */}
      <mesh ref={beamRef} position={[0, 1.0, 0]}>
        <cylinderGeometry args={[0.005, 0.08, 2.0, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} side={THREE.DoubleSide} />
      </mesh>
      {/* Outer glow beam */}
      <mesh ref={beam2Ref} position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.015, 0.14, 1.4, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>
      {/* Beam tip */}
      <mesh position={[0, 2.0, 0]}>
        <sphereGeometry args={[0.015, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={isOpen ? 1 : 0.05} />
      </mesh>
      {/* Base glow */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} />
      </mesh>
      {/* Pulse rings */}
      <mesh ref={ring1Ref}>
        <ringGeometry args={[0.08, 0.11, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring2Ref}>
        <ringGeometry args={[0.14, 0.17, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function MarketBeamsLayer() {
  return (
    <group>
      {MARKET_BEAM_CONFIG.map(beam => {
        const session = MARKET_SESSIONS.find(s => s.id === beam.sessionId)
        const open = session ? isSessionOpen(session) : false
        return <MarketBeam key={beam.sessionId} lat={beam.lat} lng={beam.lng} isOpen={open} color={beam.color} />
      })}
    </group>
  )
}

/* ═══════════════════════════════════════════════
   MAIN EXPORT
   ═══════════════════════════════════════════════ */
export default function GlobeScene({
  activeLayers, whaleAlerts = [], onCountryClick, selectedCountry,
  globeMode = 'dark', showGrid = false, showMarketBeams = true, autoRotate = true,
}) {
  return (
    <Canvas
      camera={{ fov: 32, near: 0.1, far: 100, position: [0, 0.5, 7.5] }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      style={{ background: 'transparent' }}
      dpr={[1, 2]}
    >
      <ambientLight intensity={globeMode === 'day' ? 0.3 : 0.05} />
      <directionalLight position={[5, 3, 4]} intensity={globeMode === 'day' ? 1.5 : 0.9} color="#ffffff" />
      <directionalLight position={[-4, -2, -3]} intensity={0.08} color="#8888cc" />

      <Stars radius={80} depth={80} count={5000} factor={3} saturation={0} fade speed={0.2} />

      <Suspense fallback={null}>
        <Earth onCountryClick={onCountryClick} globeMode={globeMode} />
      </Suspense>

      {showGrid && <GridOverlay />}
      {selectedCountry && <CountryHighlight country={selectedCountry} />}
      {showMarketBeams && <MarketBeamsLayer />}

      {activeLayers.includes('flows') && <CapitalFlowsLayer />}
      {activeLayers.includes('exchanges') && <CryptoNodesLayer />}
      {activeLayers.includes('whales') && <WhaleAlertsLayer alerts={whaleAlerts} />}
      {activeLayers.includes('sentiment') && <SentimentLayer />}

      <OrbitControls
        enablePan={false} enableZoom enableRotate
        minDistance={2.6} maxDistance={18}
        rotateSpeed={0.35} zoomSpeed={0.5}
        autoRotate={autoRotate} autoRotateSpeed={0.1}
        enableDamping dampingFactor={0.04}
      />
    </Canvas>
  )
}
