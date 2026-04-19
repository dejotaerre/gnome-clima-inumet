#!/usr/bin/env python3

import json
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

# ----------------------------------------------------------------------
# URLs de origen de datos
# ----------------------------------------------------------------------

URL_CLIMA         = "https://www.inumet.gub.uy/reportes/estadoActual/estadoActualV2.mch"
URL_ESTACIONES    = "https://www.inumet.gub.uy/reportes/estaciones/estaciones.mch"
URL_PRONOSTICO    = "https://www.inumet.gub.uy/reportes/pronosticos/pronosticoV4.mch"
URL_SUNRISESUNSET = "https://api.sunrisesunset.io/json"

# ----------------------------------------------------------------------
# Rutas locales
# ----------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR
BUNDLED_CONFIG_FILE = DATA_DIR / "config.json"
USER_CONFIG_FILE = Path.home() / ".config" / "weather-inumet" / "config.json"
CLIMATE_ICONS_DIR = DATA_DIR / "svg" / "clima"

CACHE_DIR = Path.home() / ".cache" / "weather-inumet"
SUN_FILE = CACHE_DIR / "sunrisesunset.json"
WEATHER_CACHE_FILE = CACHE_DIR / "weather.cache.json"

# ----------------------------------------------------------------------
# Configuración de caché
# ----------------------------------------------------------------------

WEATHER_CACHE_TTL = 600
FORCE_REFRESH = "--force" in sys.argv[1:]

# ----------------------------------------------------------------------
# Mapas de iconos SVG
# ----------------------------------------------------------------------

DAY_ICON_MAP = {
  1: "ico__claro.svg",
  2: "ico__algo-nuboso.svg",
  3: "ico__lluvias-aisladas.svg",
  4: "ico__cubierto.svg",
  5: "ico__llovizna.svg",
  6: "ico__lluvia.svg",
  7: "ico__chaparron.svg",
  8: "ico__niebla.svg",
  9: "ico__algo-cubierto.svg",
  10: "ico__relampagos.svg",
  11: "ico__tormenta.svg",
  12: "ico__ventisca.svg",
  13: "ico__nuboso.svg",
  14: "ico__humo.svg",
  15: "ico__neblina.svg",
  16: "ico__bruma.svg",
  20: "ico__noche-claro.svg",
  21: "ico__noche-algo-cubierto.svg",
  22: "ico__noche-algo-nuboso.svg",
  23: "ico__noche-lluvias-aisladas.svg",
  24: "ico__noche-nuboso.svg",
  -1: "ico__estacion-automatica.svg",
}

NIGHT_ICON_MAP = {
  1: "ico__noche-claro.svg",
  2: "ico__noche-algo-nuboso.svg",
  3: "ico__noche-lluvias-aisladas.svg",
  4: "ico__cubierto.svg",
  5: "ico__llovizna.svg",
  6: "ico__lluvia.svg",
  7: "ico__chaparron.svg",
  8: "ico__niebla.svg",
  9: "ico__noche-algo-cubierto.svg",
  10: "ico__relampagos.svg",
  11: "ico__tormenta.svg",
  12: "ico__ventisca.svg",
  13: "ico__noche-nuboso.svg",
  14: "ico__humo.svg",
  15: "ico__neblina.svg",
  16: "ico__bruma.svg",
  20: "ico__noche-claro.svg",
  21: "ico__noche-algo-cubierto.svg",
  22: "ico__noche-algo-nuboso.svg",
  23: "ico__noche-lluvias-aisladas.svg",
  24: "ico__noche-nuboso.svg",
  -1: "ico__estacion-automatica.svg",
}

# ----------------------------------------------------------------------
# Utilidades generales
# ----------------------------------------------------------------------

def print_error(message: str) -> int:
  print(json.dumps({"error": message}, ensure_ascii=False))
  return 1


def fetch_json(url: str) -> dict:
  req = urllib.request.Request(url, headers={"User-Agent": "weather.inumet.py"})
  with urllib.request.urlopen(req, timeout=30) as resp:
    return json.loads(resp.read().decode("utf-8"))


def load_config(path: Path) -> dict:
  if not path.exists():
    raise FileNotFoundError(f"No existe el archivo de configuración: {path}")

  with path.open(encoding="utf-8") as f:
    data = json.load(f)

  stations = data.get("estaciones", [])
  forecast_zones = data.get("zonas_pronostico", [])

  if not isinstance(stations, list):
    raise ValueError("El archivo de configuración tiene un formato inválido en 'estaciones'")

  if not isinstance(forecast_zones, list):
    raise ValueError("El archivo de configuración tiene un formato inválido en 'zonas_pronostico'")

  cleaned_stations = []
  for idx, item in enumerate(stations, start=1):
    if not isinstance(item, dict):
      raise ValueError(f"La estación #{idx} no es un objeto JSON válido")

    station_id = item.get("id")
    city = str(item.get("ciudad", "")).strip()
    neighborhood = str(item.get("barrio", "")).strip()

    if station_id in (None, ""):
      raise ValueError(f"La estación #{idx} no tiene 'id'")

    try:
      station_id = int(station_id)
    except ValueError as exc:
      raise ValueError(f"El 'id' de la estación #{idx} no es válido: {station_id}") from exc

    label = f"{city}, {neighborhood}".strip(", ")

    cleaned_stations.append({
      "id": station_id,
      "label": label,
      "ciudad": city,
      "barrio": neighborhood,
    })

  cleaned_forecast_zones = []
  for idx, item in enumerate(forecast_zones, start=1):
    if not isinstance(item, dict):
      raise ValueError(f"La zona de pronóstico #{idx} no es un objeto JSON válido")

    zone_id = item.get("id")
    zone_name = str(item.get("nombre", "")).strip()

    if zone_id in (None, ""):
      raise ValueError(f"La zona de pronóstico #{idx} no tiene 'id'")

    try:
      zone_id = int(zone_id)
    except ValueError as exc:
      raise ValueError(f"El 'id' de la zona de pronóstico #{idx} no es válido: {zone_id}") from exc

    cleaned_forecast_zones.append({
      "id": zone_id,
      "nombre": zone_name,
    })

  return {
    "estaciones": cleaned_stations,
    "zonas_pronostico": cleaned_forecast_zones,
  }


def read_json_file(path: Path) -> dict | None:
  if not path.exists():
    return None

  try:
    return json.loads(path.read_text(encoding="utf-8"))
  except Exception:
    return None


def write_json_file(path: Path, data: dict) -> None:
  path.write_text(
    json.dumps(data, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
  )


def read_key_values(path: Path) -> dict:
  data = {}

  if not path.exists():
    return data

  for raw_line in path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if "=" in line:
      key, value = line.split("=", 1)
      data[key.strip()] = value.strip()

  return data


def write_key_values(path: Path, data: dict) -> None:
  lines = [f"{key}={value}" for key, value in data.items()]
  path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def file_modified_today(path: Path) -> bool:
  return (
    path.exists()
    and datetime.fromtimestamp(path.stat().st_mtime).date() == datetime.now().date()
  )


def file_age_seconds(path: Path) -> float | None:
  if not path.exists():
    return None

  return datetime.now().timestamp() - path.stat().st_mtime


def get_cached_weather(ttl: int) -> dict | None:
  if FORCE_REFRESH:
    return None

  age = file_age_seconds(WEATHER_CACHE_FILE)
  if age is None or age > ttl:
    return None

  return read_json_file(WEATHER_CACHE_FILE)


def get_any_cached_weather() -> dict | None:
  if FORCE_REFRESH:
    return None
  return read_json_file(WEATHER_CACHE_FILE)


def parse_time_12h(value: str) -> str:
  return datetime.strptime(value.strip(), "%I:%M:%S %p").strftime("%H:%M:%S")


def parse_time_12h_short(value: str) -> str:
  return datetime.strptime(value.strip(), "%I:%M:%S %p").strftime("%H:%M")


# ----------------------------------------------------------------------
# Lógica de comunicación
# ----------------------------------------------------------------------

def select_station_data(stations_cfg: list[dict], weather_json: dict) -> tuple[dict, dict] | tuple[None, None]:
  stations = weather_json.get("estaciones", [])

  for station_cfg in stations_cfg:
    found = next(
      (item for item in stations if int(item.get("id", -1)) == station_cfg["id"]),
      None,
    )
    if found is not None:
      return found, station_cfg

  return None, None


def get_station_coordinates(station_id: int) -> tuple[str, str]:
  coords_file = CACHE_DIR / f"{station_id}.coords"

  if not FORCE_REFRESH and coords_file.exists():
    coords = read_key_values(coords_file)
    return coords.get("Latitud", ""), coords.get("Longitud", "")

  stations_json = fetch_json(URL_ESTACIONES)
  station_info = next(
    (
      item
      for item in stations_json.get("estaciones", [])
      if int(item.get("id", -1)) == station_id
    ),
    {},
  )

  latitude = str(station_info.get("Latitud", ""))
  longitude = str(station_info.get("Longitud", ""))

  write_key_values(coords_file, {
    "Latitud": latitude,
    "Longitud": longitude,
  })

  return latitude, longitude


def get_solar_data(latitude: str, longitude: str) -> tuple[str, str]:
  if not FORCE_REFRESH and file_modified_today(SUN_FILE):
    sun_data = read_json_file(SUN_FILE)
    if sun_data and "sunrise_raw" in sun_data and "sunset_raw" in sun_data:
      return sun_data["sunrise_raw"], sun_data["sunset_raw"]

  sun_json = fetch_json(f"{URL_SUNRISESUNSET}?lat={latitude}&lng={longitude}")
  sunrise_raw = sun_json["results"]["sunrise"]
  sunset_raw = sun_json["results"]["sunset"]

  write_json_file(SUN_FILE, {
    "sunrise_raw": sunrise_raw,
    "sunset_raw": sunset_raw,
    "sunrise": parse_time_12h_short(sunrise_raw),
    "sunset": parse_time_12h_short(sunset_raw),
    "latitude": latitude,
    "longitude": longitude,
    "updated_at": datetime.now().isoformat(timespec="seconds"),
  })

  return sunrise_raw, sunset_raw


def is_daytime(sunrise: str, sunset: str) -> bool:
  current_time = datetime.now().strftime("%H:%M:%S")
  sunrise_24h = parse_time_12h(sunrise)
  sunset_24h = parse_time_12h(sunset)
  return sunrise_24h < current_time < sunset_24h


def detect_forecast_period(subgroup_name: str) -> str:
  name = subgroup_name.strip().lower()
  if "noche" in name or "tarde/noche" in name:
    return "night"
  if "mañana" in name or "manana" in name or "tarde" in name:
    return "day"
  return "auto"


def resolve_icon_filename(icon_code_raw, sunrise: str, sunset: str) -> str:
  try:
    icon_code = int(icon_code_raw)
  except Exception:
    return ""

  icon_map = DAY_ICON_MAP if is_daytime(sunrise, sunset) else NIGHT_ICON_MAP
  return icon_map.get(icon_code, "")


def resolve_svg_icon_path(icon_code_raw, period: str = "auto") -> str:
  try:
    icon_code = int(icon_code_raw)
  except Exception:
    return ""

  if period == "night":
    icon_filename = NIGHT_ICON_MAP.get(icon_code) or DAY_ICON_MAP.get(icon_code) or ""
  elif period == "day":
    icon_filename = DAY_ICON_MAP.get(icon_code) or NIGHT_ICON_MAP.get(icon_code) or ""
  else:
    icon_filename = DAY_ICON_MAP.get(icon_code) or NIGHT_ICON_MAP.get(icon_code) or ""

  if not icon_filename:
    return ""

  return str(CLIMATE_ICONS_DIR / icon_filename)


# ----------------------------------------------------------------------
# Lógica de pronóstico
# ----------------------------------------------------------------------

def select_forecast_zone(forecast_zones_cfg: list[dict], forecast_json: dict) -> tuple[list[dict], dict] | tuple[None, None]:
  items = forecast_json.get("items", [])

  for zone_cfg in forecast_zones_cfg:
    matches = [
      item for item in items
      if int(item.get("zonaId", -1)) == zone_cfg["id"]
    ]
    if matches:
      return matches, zone_cfg

  return None, None


def find_forecast_day(zone_items: list[dict], day_offset: int) -> dict | None:
  for item in zone_items:
    try:
      if int(item.get("diaMasN", -999)) == day_offset:
        return item
    except Exception:
      continue

  return None


def normalize_forecast_item(item: dict) -> dict:
  if not item:
    return {}

  subgrupos = []

  for sub in item.get("subgrupos", []):
    period = detect_forecast_period(str(sub.get("subgrupo", "")))
    sub_icono = resolve_svg_icon_path(str(sub.get("estadoTiempo", "")), period=period)

    subgrupos.append({
      "orden": sub.get("orden", ""),
      "subgrupo": str(sub.get("subgrupo", "")),
      "icono": sub_icono,
      "descripcion": str(sub.get("descripcion", "")),
      "evolucion": str(sub.get("evolucion", "")),
      "descripcionExtra": str(sub.get("descripcionExtra", "")),
      "vientos": str(sub.get("vientos", "")),
    })

  icono = resolve_svg_icon_path(str(item.get("estadoTiempo", "")), period="day")

  return {
    "icono": icono,
    "tempMin": str(item.get("tempMin", "")),
    "tempMax": str(item.get("tempMax", "")),
    "grupo": str(item.get("grupo", "")),
    "subgrupos": subgrupos,
  }


# ----------------------------------------------------------------------
# Programa principal
# ----------------------------------------------------------------------

def main() -> int:
  CACHE_DIR.mkdir(parents=True, exist_ok=True)

  try:
    config_path = USER_CONFIG_FILE if USER_CONFIG_FILE.exists() else BUNDLED_CONFIG_FILE
    config = load_config(config_path)
    stations_cfg = config["estaciones"]
    forecast_zones_cfg = config["zonas_pronostico"]
  except Exception as exc:
    return print_error(str(exc))

  if not stations_cfg:
    return print_error("No hay estaciones configuradas")

  using_cache = False
  warning_message = ""

  weather_json = get_cached_weather(WEATHER_CACHE_TTL)

  if weather_json is None:
    try:
      weather_json = fetch_json(URL_CLIMA)
      write_json_file(WEATHER_CACHE_FILE, weather_json)
    except Exception as exc:
      cached = get_any_cached_weather()

      if cached is None:
        return print_error(
          f"No se pudo obtener el clima y no hay caché disponible: {exc}"
        )

      weather_json = cached
      using_cache = True
      warning_message = "Mostrando datos en caché; no se pudo actualizar desde INUMET."

  station_data, station_cfg = select_station_data(stations_cfg, weather_json)

  if station_data is None:
    ids = "/".join(str(item["id"]) for item in stations_cfg)
    print(
      json.dumps(
        {
          "estacion": str(stations_cfg[-1]["id"]),
          "localidad": stations_cfg[-1]["label"],
          "cache": using_cache,
          "warning": warning_message,
          "error": f"SIN DATOS DE {ids}",
        },
        ensure_ascii=False,
        indent=2,
      )
    )
    return 1

  try:
    station_id = int(station_data.get("id"))
    latitude, longitude = get_station_coordinates(station_id)
  except Exception as exc:
    return print_error(f"No se pudieron obtener coordenadas: {exc}")

  try:
    sunrise_raw, sunset_raw = get_solar_data(latitude, longitude)
    sunrise = parse_time_12h_short(sunrise_raw)
    sunset = parse_time_12h_short(sunset_raw)
  except Exception as exc:
    return print_error(f"No se pudieron obtener datos solares: {exc}")

  try:
    icon_filename = resolve_icon_filename(
      station_data.get("iconoTiempoPresente"),
      sunrise_raw,
      sunset_raw,
    )
  except Exception as exc:
    return print_error(f"No se pudo resolver el icono: {exc}")

  forecast_zone_name = ""
  forecast_hoy = {}
  forecast_24hs = {}
  forecast_48hs = {}

  if forecast_zones_cfg:
    try:
      forecast_json = fetch_json(URL_PRONOSTICO)
      zone_items, forecast_zone_cfg = select_forecast_zone(forecast_zones_cfg, forecast_json)

      if zone_items is not None:
        forecast_zone_name = forecast_zone_cfg.get("nombre", "")

        hoy = find_forecast_day(zone_items, 0)
        maniana = find_forecast_day(zone_items, 1)
        pasado_maniana = find_forecast_day(zone_items, 2)

        forecast_hoy = normalize_forecast_item(hoy)
        forecast_24hs = normalize_forecast_item(maniana)
        forecast_48hs = normalize_forecast_item(pasado_maniana)

    except Exception:
      forecast_zone_name = ""
      forecast_hoy = {}
      forecast_24hs = {}
      forecast_48hs = {}

  output = {
    "id": str(station_data.get("id", "")),
    "estacion": str(station_data.get("estacion", "")),
    "localidad": station_cfg["label"],
    "cielo": str(station_data.get("cielo", "")),
    "textotiempo": str(station_data.get("textotiempoPresente", "")),
    "temperatura": str(station_data.get("temperatura", "")),
    "humedad": str(station_data.get("humedad", "")),
    "icono": str(CLIMATE_ICONS_DIR / icon_filename) if icon_filename else "",
    "salidasol": sunrise,
    "puestasol": sunset,
    "cache": using_cache,
    "warning": warning_message,
    "zonaPronostico": forecast_zone_name,
    "pronostico_hoy": forecast_hoy,
    "pronostico_24hs": forecast_24hs,
    "pronostico_48hs": forecast_48hs,
  }

  print(json.dumps(output, ensure_ascii=False, indent=2))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())