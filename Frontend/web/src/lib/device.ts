"use client";
/**
 * This phone's install id (spec §6.2: mobile punch only from a registered phone).
 * Created once and kept on the phone; HR approves it in the ERP. Clearing the
 * browser data creates a new id, which HR must approve again.
 */
const KEY = "erp-device-id";

export function deviceId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `pwa-${crypto.randomUUID()}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

/** A readable default name, e.g. "Android phone" / "iPhone". */
export function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  const model = /Android [\d.]+; ([^;)]+)/.exec(ua)?.[1];
  if (model && !/^K$/.test(model)) return model.trim().slice(0, 100);
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android phone";
  return "Browser";
}

/**
 * The phone's position with its accuracy in metres (the server refuses weak readings
 * and keeps the accuracy with the punch), or an error code (denied / unavailable / timeout).
 */
export function currentPosition(): Promise<{
  latitude: number;
  longitude: number;
  accuracy: number;
}> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("unavailable"));
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: Math.round(p.coords.accuracy),
        }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? "denied"
              : e.code === e.TIMEOUT
                ? "timeout"
                : "unavailable",
          ),
        ),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}
