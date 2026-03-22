import { IconLayer } from '@deck.gl/layers';
import { getWindBarbKey } from '../../utils/windBarbs';
import type { WindBarbMapping } from '../../utils/windBarbs';
import type { WindPoint } from '../../stores/appStore';

export function createWindBarbLayer(
  data: WindPoint[],
  iconAtlas: HTMLCanvasElement | string,
  iconMapping: WindBarbMapping,
): IconLayer<WindPoint> {
  return new IconLayer<WindPoint>({
    id: 'wind-barbs',
    data,
    getPosition: (d) => [d.lon, d.lat],
    getIcon: (d) => getWindBarbKey(d.speed),
    getAngle: (d) => -d.direction,
    getSize: 40,
    iconAtlas,
    iconMapping: iconMapping as Record<string, {x: number; y: number; width: number; height: number}>,
    sizeUnits: 'pixels',
    sizeMinPixels: 20,
    sizeMaxPixels: 50,
    pickable: false,
  });
}
