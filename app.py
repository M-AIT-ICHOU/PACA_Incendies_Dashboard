from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import streamlit as st
import streamlit.components.v1 as components

import folium


ROOT = Path(__file__).resolve().parent

COMMUNES_SHP = ROOT / "data" / "Commune" / "CommunesPromethee.shp"
ZONE_SHP = ROOT / "data" / "Commune" / "zonePromethee.shp"


def _inject_fullscreen_css() -> None:
    # Force the map iframe to cover the entire screen, hiding all Streamlit UI.
    st.markdown(
        """
<style>
html, body {
  height: 100%;
  margin: 0;
  overflow: hidden;
}

/* Hide all Streamlit chrome */
#MainMenu, header, footer,
[data-testid="stHeader"],
[data-testid="stToolbar"],
[data-testid="stDecoration"],
[data-testid="stFooter"],
[data-testid="stStatusWidget"] {
  display: none !important;
}

/* Remove paddings/gutters */
.block-container {
  max-width: 100% !important;
  padding: 0 !important;
  margin: 0 !important;
}

/* Keep layout containers full height but visible so the iframe can render */
[data-testid="stAppViewContainer"],
[data-testid="stMainBlockContainer"],
[data-testid="stVerticalBlock"],
[data-testid="stHorizontalBlock"] {
    padding: 0 !important;
    margin: 0 !important;
    height: 100vh !important;
    min-height: 100vh !important;
    overflow: hidden !important;
}

/* Force iframe to cover the entire viewport with fixed positioning */
div[data-testid="stIFrame"] {
    position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  z-index: 9999 !important;
}

div[data-testid="stIFrame"] iframe {
  width: 100% !important;
  height: 100% !important;
  border: 0 !important;
  display: block !important;
}

/* Ensure folium map element fills the iframe */
.folium-map {
    width: 100vw !important;
    height: 100vh !important;
}

/* Hide Leaflet zoom buttons and scale bar */
.leaflet-control-zoom,
.leaflet-control-scale {
    display: none !important;
}
</style>
        """,
        unsafe_allow_html=True,
    )


@st.cache_data(show_spinner=False)
def _read_wgs84(path: Path) -> gpd.GeoDataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Fichier introuvable: {path}")

    gdf = gpd.read_file(path)
    # If CRS is missing, assume Lambert-93 (common for FR datasets)
    if gdf.crs is None:
        gdf = gdf.set_crs(2154)
    return gdf.to_crs(4326)


def _build_map(communes: gpd.GeoDataFrame, zone: gpd.GeoDataFrame) -> folium.Map:
    minx, miny, maxx, maxy = zone.total_bounds
    center_lat = float((miny + maxy) / 2)
    center_lon = float((minx + maxx) / 2)

    m = folium.Map(
        location=[center_lat, center_lon],
        zoom_start=8,
        control_scale=False,  # remove scale bar
        zoom_control=False,    # remove zoom buttons
        tiles=None,
        prefer_canvas=True,
    )

    # Basemaps: Dark (par défaut), Clair, Satellite
    folium.TileLayer(
        tiles="https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png",
        attr='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        name="Foncé",
        overlay=False,
        control=True,
        show=True,
    ).add_to(m)

    folium.TileLayer(
        tiles="https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png",
        attr='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        name="Clair",
        overlay=False,
        control=True,
        show=False,
    ).add_to(m)

    folium.TileLayer(
        tiles="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attr='Tiles &copy; Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        name="Satellite",
        overlay=False,
        control=True,
        show=False,
    ).add_to(m)

    folium.GeoJson(
        zone,
        name="Zone Prométhée",
        style_function=lambda _: {"color": "#00d1ff", "weight": 3, "fillOpacity": 0.0},
    ).add_to(m)

    communes_simpl = communes.copy()
    try:
        communes_simpl["geometry"] = communes_simpl["geometry"].simplify(0.0012, preserve_topology=True)
    except Exception:
        pass

    folium.GeoJson(
        communes_simpl,
        name="Communes",
        style_function=lambda _: {"color": "#7aa6ff", "weight": 0.45, "fillOpacity": 0.0},
    ).add_to(m)

    m.fit_bounds([[miny, minx], [maxy, maxx]])
    folium.LayerControl(collapsed=True).add_to(m)
    return m


@st.cache_data(show_spinner=False)
def _map_html() -> str:
    communes = _read_wgs84(COMMUNES_SHP)
    zone = _read_wgs84(ZONE_SHP)
    m = _build_map(communes, zone)
    html = m.get_root().render()
    hide_controls_css = """
<style>
.leaflet-control-zoom,
.leaflet-control-scale {
  display: none !important;
}
</style>
    """
    js = """
<script>
(function() {
    function resize() {
        try {
            var iframe = window.frameElement;
            var h = (window.parent && window.parent.innerHeight) ? window.parent.innerHeight : window.innerHeight;
            if (iframe) {
                iframe.style.height = h + 'px';
                iframe.style.width = '100%';
            }
        } catch(e) {
            // ignore
        }
    }
    window.addEventListener('load', resize);
    window.addEventListener('resize', resize);
    setTimeout(resize, 50);
    setTimeout(resize, 250);
})();
</script>
    """
    return html + hide_controls_css + js


def main() -> None:
    st.set_page_config(page_title="Carte — Zone Prométhée", layout="wide", initial_sidebar_state="collapsed")
    _inject_fullscreen_css()

    try:
        html = _map_html()
    except Exception as exc:  # noqa: BLE001
        st.error("Impossible de charger la carte.")
        st.exception(exc)
        return

    # Height is overridden by CSS to 100vh; keep a safe default here.
    components.html(html, height=900, scrolling=False)


if __name__ == "__main__":
    main()
