import type {StyleSpecification} from 'maplibre-gl'

/** Owned client style. One public raster, no key, no style JSON hosted elsewhere. */
export const satelliteStyle: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
  },
  layers: [{id: 'satellite', type: 'raster', source: 'satellite'}],
}
