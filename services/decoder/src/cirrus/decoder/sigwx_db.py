"""Store parsed SIGWX features in PostgreSQL."""
import json
import logging

import psycopg

from cirrus.decoder.sigwx_parser import SigwxFeature, SigwxMetadata

logger = logging.getLogger(__name__)


def store_sigwx(
    conn: psycopg.Connection,
    source_file: str,
    metadata: SigwxMetadata,
    features: list[SigwxFeature],
) -> int:
    """Store SIGWX features in the database. Returns count of inserted rows.

    Deletes existing features for the same source_file first (idempotent).
    Caller is responsible for supplying a connection; this function does not
    commit or close it.
    """
    with conn.transaction():
        conn.execute(
            "DELETE FROM sigwx_features WHERE source_file = %s",
            (source_file,),
        )

        count = 0
        cur = conn.cursor()
        for feat in features:
            geojson = {
                "type": "Feature",
                "geometry": {
                    "type": feat.geometry_type,
                    "coordinates": feat.coordinates,
                },
                "properties": {
                    "phenomenon": feat.phenomenon,
                    **feat.properties,
                },
            }

            cur.execute(
                """INSERT INTO sigwx_features
                   (source_file, originating_centre, issue_time, base_time, valid_time,
                    phenomenon, geometry_type, geojson, properties)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    source_file,
                    metadata.originating_centre,
                    metadata.issue_time,
                    metadata.phenomenon_base_time,
                    metadata.phenomenon_time,
                    feat.phenomenon,
                    feat.geometry_type,
                    json.dumps(geojson),
                    json.dumps(feat.properties),
                ),
            )
            count += 1

    logger.info("Stored %d SIGWX features from %s", count, source_file)
    return count
