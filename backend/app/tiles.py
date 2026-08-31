"""Render map tiles from an in-memory (lat, lon) DataArray via rio-tiler.

rio-tiler only cuts/reprojects/colormaps here - all science happens in
derive.py before the field reaches this module.
"""

import rioxarray  # noqa: F401  (registers the .rio accessor)
import xarray as xr
from rio_tiler.colormap import cmap as colormaps
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.io.xarray import XarrayReader

__all__ = ["render_tile", "TileOutsideBounds"]


def _to_raster(da: xr.DataArray) -> xr.DataArray:
    """(lat, lon) -> north-up (y, x) with CRS, as rio-tiler expects."""
    da = da.rename({"lat": "y", "lon": "x"}).sortby("y", ascending=False)
    return da.rio.write_crs("EPSG:4326")


def render_tile(
    da: xr.DataArray,
    z: int,
    x: int,
    y: int,
    cutoff: float,
    colormap_name: str | None = None,
    rescale: tuple[float, float] | None = None,
    bins: list | None = None,
) -> bytes:
    """PNG tile bytes; values below `cutoff` (or NaN) are transparent.

    Continuous mode uses colormap_name + rescale; binned mode maps raw values
    through `bins` = [[lo, hi, [r, g, b, a]], ...] discrete classes.

    Raises TileOutsideBounds when the tile doesn't intersect the field.
    """
    with XarrayReader(_to_raster(da)) as reader:
        img = reader.tile(x, y, z, tilesize=256)
    arr = img.array
    arr.mask = arr.mask | ~(arr.data >= cutoff)
    img.array = arr
    if bins is not None:
        colormap = [((lo, hi), tuple(rgba)) for lo, hi, rgba in bins]
    else:
        img.rescale(in_range=(rescale,))
        colormap = colormaps.get(colormap_name)
    return img.render(img_format="PNG", colormap=colormap)
