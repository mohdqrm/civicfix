// Leaflet + OpenStreetMap (free, no API key).
//   ComplaintMap   — shows complaints as pins coloured by status; click a pin for details.
//   LocationPicker — the citizen clicks the map (or drags the pin) to mark where the problem is.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents, Circle } from 'react-leaflet';
import { DEFAULT_CENTER, STATUSES, STATUS_LABEL, timeAgo } from '../lib/format.js';

const pinIcon = (cls) =>
  L.divIcon({ className: '', html: `<div class="pin ${cls}"></div>`, iconSize: [20, 20], iconAnchor: [10, 20], popupAnchor: [0, -20] });
const icons = Object.fromEntries(STATUSES.map((s) => [s.value, pinIcon(s.value)]));
const pickedIcon = L.divIcon({ className: '', html: '<div class="pin picked"></div>', iconSize: [28, 28], iconAnchor: [14, 28] });

function Tiles() {
  return (
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      maxZoom={19}
    />
  );
}

/** Zoom the map to show all markers whenever the set of markers changes. */
function FitToMarkers({ markers, enabled }) {
  const map = useMap();
  const key = markers.map((m) => m.id).join(',');
  useEffect(() => {
    if (!enabled || !markers.length) return;
    if (markers.length === 1) map.setView([markers[0].latitude, markers[0].longitude], 16);
    else map.fitBounds(L.latLngBounds(markers.map((m) => [m.latitude, m.longitude])), { padding: [36, 36], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return null;
}

function FlyTo({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, zoom ?? map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.[0], center?.[1]]);
  return null;
}

export function ComplaintMap({ markers, className = 'map', fit = true, center, zoom = 14, nearMe, interactive = true, linkFor }) {
  return (
    <MapContainer
      center={center ?? DEFAULT_CENTER}
      zoom={zoom}
      className={className}
      scrollWheelZoom={interactive}
      dragging={interactive}
      zoomControl={interactive}
    >
      <Tiles />
      <FitToMarkers markers={markers} enabled={fit && !nearMe} />
      {nearMe && (
        <>
          <FlyTo center={[nearMe.lat, nearMe.lng]} zoom={15} />
          <Circle center={[nearMe.lat, nearMe.lng]} radius={nearMe.radius} pathOptions={{ color: '#1F5E4E', weight: 1.5, fillOpacity: 0.06 }} />
        </>
      )}
      {markers.map((m) => (
        <Marker key={m.id} position={[m.latitude, m.longitude]} icon={icons[m.status]} title={`${m.trackingId}: ${m.title}`}>
          <Popup>
            <strong>{m.title}</strong>
            <p>
              {m.category.name}, {STATUS_LABEL[m.status].toLowerCase()}
            </p>
            <p className="muted">
              {m.trackingId}, reported {timeAgo(m.createdAt)}
            </p>
            <Link to={linkFor ? linkFor(m) : `/issues/${m.id}`}>View details</Link>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

export function MapLegend() {
  return (
    <div className="map-legend" aria-label="Map legend">
      {STATUSES.map((s) => (
        <span key={s.value} style={{ '--c': `var(--s-${s.value})` }}>
          <i />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function ClickToPick({ onPick }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

export function LocationPicker({ value, onChange, flyTo }) {
  return (
    <MapContainer center={value ? [value.lat, value.lng] : DEFAULT_CENTER} zoom={value ? 17 : 14} className="map" style={{ cursor: 'crosshair' }}>
      <Tiles />
      <ClickToPick onPick={onChange} />
      {flyTo && <FlyTo center={[flyTo.lat, flyTo.lng]} zoom={17} />}
      {value && (
        <Marker
          position={[value.lat, value.lng]}
          icon={pickedIcon}
          draggable
          eventHandlers={{ dragend: (e) => onChange({ lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng }) }}
          title="Problem location — drag to adjust"
        />
      )}
    </MapContainer>
  );
}

/** Ask the browser for the user's position. Resolves { lat, lng } or rejects with a readable message. */
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Your browser can’t share its location. Pick the spot on the map instead.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) =>
        reject(
          new Error(
            err.code === 1
              ? 'Location permission was denied. Allow it in your browser settings, or pick the spot on the map.'
              : 'Couldn’t get your location. Pick the spot on the map instead.'
          )
        ),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}
