/** Request browser permissions used by API voice/vision and Tesla features. Denials are non-fatal. */
export async function requestApiFeaturePermissions(): Promise<void> {
  const stop = (stream: MediaStream) => {
    for (const track of stream.getTracks()) track.stop()
  }

  // Mic + camera together when possible (one prompt in most browsers).
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      stop(await navigator.mediaDevices.getUserMedia({ audio: true, video: true }))
    } catch {
      try {
        stop(await navigator.mediaDevices.getUserMedia({ audio: true }))
      } catch {
        /* Microphone denied or unavailable. */
      }
      try {
        stop(await navigator.mediaDevices.getUserMedia({ video: true }))
      } catch {
        /* Camera denied or unavailable. */
      }
    }
  }

  // Geolocation (Tesla GPS speed / live location).
  if (navigator.geolocation) {
    await new Promise<void>((resolve) => {
      try {
        navigator.geolocation.getCurrentPosition(
          () => resolve(),
          () => resolve(),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
        )
      } catch {
        resolve()
      }
    })
  }

  // Notifications when the browser supports them.
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
  } catch {
    /* Notifications unsupported or blocked. */
  }

  // Native speech recognition (Capacitor iOS) when the plugin is present.
  try {
    const { SpeechRecognition } = await import('@capgo/capacitor-speech-recognition')
    await SpeechRecognition.requestPermissions()
  } catch {
    /* Web build or plugin unavailable. */
  }
}
