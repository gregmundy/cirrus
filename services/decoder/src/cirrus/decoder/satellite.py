"""GOES-16 ABI satellite imagery acquisition and processing.

Downloads CONUS sector Cloud and Moisture Imagery (CMI) from the public
NOAA S3 bucket, reprojects from GOES fixed-grid to equirectangular
lat/lon, and writes processed data for the backend to serve.
"""

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import boto3
import netCDF4 as nc
import numpy as np
from botocore import UNSIGNED
from botocore.config import Config

logger = logging.getLogger(__name__)

BUCKET = "noaa-goes19"
PRODUCT = "ABI-L2-CMIPC"  # CONUS CMI

# Channels to acquire
CHANNELS = {
    2: {"name": "Visible", "units": "Reflectance"},
    8: {"name": "Upper WV", "units": "K"},
    13: {"name": "Clean IR", "units": "K"},
}

# Output grid: CONUS coverage
TARGET_LAT_N = 50.0
TARGET_LAT_S = 24.0
TARGET_LON_W = -125.0
TARGET_LON_E = -66.0
TARGET_NJ = 500  # latitude points
TARGET_NI = 900  # longitude points


def get_s3_client():
    """Create an anonymous S3 client for the public GOES bucket."""
    return boto3.client(
        "s3",
        config=Config(signature_version=UNSIGNED),
        region_name="us-east-1",
    )


def find_latest_file(s3, channel: int) -> str | None:
    """Find the latest CONUS CMI file for a given channel."""
    now = datetime.now(timezone.utc)
    channel_str = f"C{channel:02d}"

    # Search current hour, then previous hours
    for hour_offset in range(4):
        search_time = datetime(
            now.year, now.month, now.day, now.hour, tzinfo=timezone.utc
        )
        from datetime import timedelta
        search_time -= timedelta(hours=hour_offset)

        doy = search_time.timetuple().tm_yday
        prefix = f"{PRODUCT}/{search_time.year}/{doy:03d}/{search_time.hour:02d}/"

        resp = s3.list_objects_v2(Bucket=BUCKET, Prefix=prefix, MaxKeys=500)
        if "Contents" not in resp:
            continue

        # Find files matching our channel
        candidates = [
            obj["Key"]
            for obj in resp["Contents"]
            if f"M6{channel_str}_" in obj["Key"]
        ]
        if candidates:
            # Return the latest one (last in sorted order)
            return sorted(candidates)[-1]

    return None


def download_channel(s3, key: str, output_dir: str) -> str:
    """Download a GOES NetCDF4 file to the output directory."""
    filename = key.split("/")[-1]
    local_path = os.path.join(output_dir, filename)
    if os.path.exists(local_path):
        return local_path
    s3.download_file(BUCKET, key, local_path)
    return local_path


def reproject_goes(nc_path: str) -> dict:
    """Reproject a GOES NetCDF4 CMI file to a regular lat/lon grid.

    Returns dict with metadata and float32 values array.
    """
    ds = nc.Dataset(nc_path)
    cmi = ds.variables["CMI"][:].astype(np.float32)
    x = ds.variables["x"][:]
    y = ds.variables["y"][:]

    proj = ds.variables["goes_imager_projection"]
    lon0 = float(proj.longitude_of_projection_origin)
    H = float(proj.perspective_point_height) + float(proj.semi_major_axis)
    r_eq = float(proj.semi_major_axis)
    r_pol = float(proj.semi_minor_axis)

    # Get timestamp
    t_var = ds.variables["t"]
    t_val = nc.num2date(t_var[:], t_var.units)
    if hasattr(t_val, '__iter__'):
        t_val = list(t_val)[0]
    ts_str = str(t_val).replace(" ", "T") + "Z"

    # Get channel number
    band = int(ds.variables.get("band_id", [0])[0])

    # Downsample high-res channels (Ch02 is 6000x10000)
    step = 1
    if cmi.shape[0] > 2000:
        step = cmi.shape[0] // 1500
        cmi = cmi[::step, ::step]
        x = x[::step]
        y = y[::step]

    # GOES fixed-grid to lat/lon conversion
    xx, yy = np.meshgrid(x, y)
    a = np.sin(xx) ** 2 + np.cos(xx) ** 2 * (
        np.cos(yy) ** 2 + (r_eq / r_pol) ** 2 * np.sin(yy) ** 2
    )
    b = -2 * H * np.cos(xx) * np.cos(yy)
    c = H**2 - r_eq**2
    det = b**2 - 4 * a * c
    valid = det >= 0

    rs = np.where(valid, (-b - np.sqrt(np.maximum(det, 0))) / (2 * a), np.nan)
    sx = rs * np.cos(xx) * np.cos(yy)
    sy = -rs * np.sin(xx)
    sz = rs * np.cos(xx) * np.sin(yy)

    lat = np.degrees(
        np.arctan((r_eq / r_pol) ** 2 * sz / np.sqrt((H - sx) ** 2 + sy ** 2))
    )
    lon = np.degrees(np.arctan(sy / (H - sx))) + lon0
    lat[~valid] = np.nan
    lon[~valid] = np.nan

    # Resample to regular CONUS grid using KDTree + smoothing
    target_lat = np.linspace(TARGET_LAT_N, TARGET_LAT_S, TARGET_NJ)
    target_lon = np.linspace(TARGET_LON_W, TARGET_LON_E, TARGET_NI)

    from scipy.spatial import cKDTree
    from scipy.ndimage import uniform_filter

    src_lat = lat.flatten()
    src_lon = lon.flatten()
    src_val = cmi.flatten()
    mask = ~(np.isnan(src_lat) | np.isnan(src_lon))

    tree = cKDTree(np.column_stack([src_lon[mask], src_lat[mask]]))
    tlon, tlat = np.meshgrid(target_lon, target_lat)
    target_pts = np.column_stack([tlon.flatten(), tlat.flatten()])

    distances, indices = tree.query(target_pts)
    resampled = src_val[mask][indices].reshape(TARGET_NJ, TARGET_NI)

    # Mark pixels too far from any source point as outside satellite coverage
    max_dist = 0.5  # degrees
    outside = distances.reshape(TARGET_NJ, TARGET_NI) > max_dist

    # Smooth with 3x3 box filter to eliminate scan-line artifacts
    resampled = uniform_filter(resampled, size=3)

    # Set outside-coverage to NaN (will be transparent in frontend)
    resampled[outside] = np.nan

    ds.close()

    return {
        "channel": band,
        "channel_name": CHANNELS.get(band, {}).get("name", f"Ch{band}"),
        "units": CHANNELS.get(band, {}).get("units", ""),
        "timestamp": ts_str,
        "ni": TARGET_NI,
        "nj": TARGET_NJ,
        "lat_first": TARGET_LAT_N,
        "lon_first": TARGET_LON_W,
        "d_lat": -(TARGET_LAT_N - TARGET_LAT_S) / (TARGET_NJ - 1),
        "d_lon": (TARGET_LON_E - TARGET_LON_W) / (TARGET_NI - 1),
        "value_min": float(np.nanmin(resampled)),
        "value_max": float(np.nanmax(resampled)),
        "values": np.nan_to_num(resampled, nan=-999.0).astype(np.float32).tobytes().hex(),
    }


def process_channel(s3, channel: int, output_dir: str) -> bool:
    """Download and process a single GOES channel. Returns True on success."""
    key = find_latest_file(s3, channel)
    if not key:
        logger.warning("No GOES data found for channel %d", channel)
        return False

    logger.info("Downloading GOES Ch%d: %s", channel, key.split("/")[-1])
    nc_path = download_channel(s3, key, output_dir)

    logger.info("Reprojecting GOES Ch%d...", channel)
    t0 = time.time()
    result = reproject_goes(nc_path)
    elapsed = time.time() - t0
    logger.info(
        "GOES Ch%d processed in %.1fs: %dx%d, %.1f-%.1f %s",
        channel, elapsed, result["ni"], result["nj"],
        result["value_min"], result["value_max"], result["units"],
    )

    # Write processed data as JSON
    out_path = os.path.join(output_dir, f"ch{channel:02d}.json")
    with open(out_path, "w") as f:
        json.dump(result, f)

    # Clean up raw NetCDF4
    try:
        os.remove(nc_path)
    except OSError:
        pass

    return True


def acquire_all(output_dir: str = "/data/satellite"):
    """Acquire and process all configured GOES channels."""
    os.makedirs(output_dir, exist_ok=True)
    s3 = get_s3_client()

    for channel in CHANNELS:
        try:
            process_channel(s3, channel, output_dir)
        except Exception:
            logger.exception("Failed to process GOES channel %d", channel)


def poll_loop(output_dir: str = "/data/satellite", interval: int = 300):
    """Poll for new GOES data at the specified interval (seconds)."""
    logger.info("Starting GOES satellite polling loop (interval=%ds)", interval)
    while True:
        try:
            acquire_all(output_dir)
        except Exception:
            logger.exception("GOES acquisition cycle failed")
        time.sleep(interval)
