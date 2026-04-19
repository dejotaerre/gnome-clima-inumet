import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const URL_ESTACIONES = 'https://www.inumet.gub.uy/reportes/estaciones/estaciones.mch';
const URL_ESTADO_ACTUAL = 'https://www.inumet.gub.uy/reportes/estadoActual/estadoActualV2.mch';
const URL_PRONOSTICO = 'https://www.inumet.gub.uy/reportes/pronosticos/pronosticoV4.mch';

function firstString(obj, keys, fallback = '') {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) {
      const value = String(obj[key]).trim();
      if (value !== '')
        return value;
    }
  }
  return fallback;
}

function uniqueById(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const id = Number(item.id);
    if (!Number.isFinite(id))
      continue;

    if (seen.has(id))
      continue;

    seen.add(id);
    result.push(item);
  }

  return result;
}

export default class WeatherInumetPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    window.set_default_size(680, 980);
    window.search_enabled = true;

    this._window = window;
    this._loading = true;

    this._configDir = GLib.build_filenamev([
      GLib.get_user_config_dir(),
      'weather-inumet',
    ]);

    this._userConfigPath = GLib.build_filenamev([
      this._configDir,
      'config.json',
    ]);

    this._defaultConfigPath = GLib.build_filenamev([
      this.path,
      'data',
      'config.json',
    ]);

    this._stations = [];
    this._zones = [];

    this._currentConfig = this._loadInitialConfig();

    const page = new Adw.PreferencesPage({
      title: 'INUMET',
      icon_name: 'weather-overcast-symbolic',
      name: 'inumet',
    });

    const groupStations = new Adw.PreferencesGroup({
      title: 'Estaciones',
      description: 'Elegí la estación principal y dos alternativas, en “Barrio o referencia” podés escribir el nombre que prefieras.\n(los cambios se aplican en algunos minutos o al presionar actualizar)',
    });

    const groupZones = new Adw.PreferencesGroup({
      title: 'Pronóstico 24/48 hs',
      description: 'Elegí la zona principal y dos alternativas para el pronóstico extendido.',
    });

    const groupActions = new Adw.PreferencesGroup({
      title: 'Acciones',
      description: 'La configuración se guarda automáticamente.',
    });

    this._stationRow1 = this._createComboRow('Estación principal');
    this._stationBarrio1 = this._createEntryRow('Barrio o referencia principal');

    this._stationRow2 = this._createComboRow('Estación alternativa 1');
    this._stationBarrio2 = this._createEntryRow('Barrio o referencia alternativa 1');

    this._stationRow3 = this._createComboRow('Estación alternativa 2');
    this._stationBarrio3 = this._createEntryRow('Barrio o referencia alternativa 2');

    this._zoneRow1 = this._createComboRow('Zona principal');
    this._zoneRow2 = this._createComboRow('Zona alternativa 1');
    this._zoneRow3 = this._createComboRow('Zona alternativa 2');

    groupStations.add(this._stationRow1);
    groupStations.add(this._stationBarrio1);

    groupStations.add(this._stationRow2);
    groupStations.add(this._stationBarrio2);

    groupStations.add(this._stationRow3);
    groupStations.add(this._stationBarrio3);

    groupZones.add(this._zoneRow1);
    groupZones.add(this._zoneRow2);
    groupZones.add(this._zoneRow3);

    this._statusRow = new Adw.ActionRow({
      title: 'Estado',
      subtitle: 'Cargando estaciones y zonas desde INUMET...',
    });
    groupActions.add(this._statusRow);

    const resetButton = new Gtk.Button({
      label: 'Restaurar selección actual',
      valign: Gtk.Align.CENTER,
    });
    resetButton.connect('clicked', () => {
      this._currentConfig = this._loadInitialConfig();
      this._applySelectionFromConfig();
      this._saveConfig();
    });

    const openFileButton = new Gtk.Button({
      label: 'Abrir carpeta de configuración',
      valign: Gtk.Align.CENTER,
    });
    openFileButton.connect('clicked', () => {
      GLib.mkdir_with_parents(this._configDir, 0o755);
      const uri = Gio.File.new_for_path(this._configDir).get_uri();
      Gio.AppInfo.launch_default_for_uri(uri, null);
    });

    const rowReset = new Adw.ActionRow({
      title: 'Restaurar',
      subtitle: 'Vuelve a aplicar la selección cargada actualmente.',
      activatable: false,
    });
    rowReset.add_suffix(resetButton);

    const rowOpen = new Adw.ActionRow({
      title: 'Carpeta de configuración',
      subtitle: this._configDir,
      activatable: false,
    });
    rowOpen.add_suffix(openFileButton);

    groupActions.add(rowReset);
    groupActions.add(rowOpen);

    page.add(groupStations);
    page.add(groupZones);
    page.add(groupActions);
    window.add(page);

    this._stationBarrio1.set_text(this._currentConfig.estaciones?.[0]?.barrio ?? '');
    this._stationBarrio2.set_text(this._currentConfig.estaciones?.[1]?.barrio ?? '');
    this._stationBarrio3.set_text(this._currentConfig.estaciones?.[2]?.barrio ?? '');

    this._connectAutoSave();
    this._populateAsync();
  }

  _createComboRow(title) {
    return new Adw.ComboRow({
      title,
      subtitle: 'Cargando...',
      model: Gtk.StringList.new([]),
    });
  }

  _createEntryRow(title) {
    return new Adw.EntryRow({
      title,
    });
  }

  _connectAutoSave() {
    const rows = [
      this._stationRow1,
      this._stationRow2,
      this._stationRow3,
      this._zoneRow1,
      this._zoneRow2,
      this._zoneRow3,
    ];

    for (const row of rows) {
      row.connect('notify::selected', () => {
        if (this._loading)
          return;
        this._saveConfig();
      });
    }

    const entries = [
      this._stationBarrio1,
      this._stationBarrio2,
      this._stationBarrio3,
    ];

    for (const entry of entries) {
      entry.connect('changed', () => {
        if (this._loading)
          return;
        this._saveConfig();
      });
    }
  }

  async _populateAsync() {
    try {
      const [stations, zones] = await Promise.all([
        this._fetchStations(),
        this._fetchZones(),
      ]);

      this._stations = stations;
      this._zones = zones;

      this._setRowItems(
        this._stationRow1,
        this._stations,
        'Estación principal',
        this._currentConfig.estaciones?.[0]?.id
      );
      this._setRowItems(
        this._stationRow2,
        this._stations,
        'Estación alternativa 1',
        this._currentConfig.estaciones?.[1]?.id
      );
      this._setRowItems(
        this._stationRow3,
        this._stations,
        'Estación alternativa 2',
        this._currentConfig.estaciones?.[2]?.id
      );

      this._setRowItems(
        this._zoneRow1,
        this._zones,
        'Zona principal',
        this._currentConfig.zonas_pronostico?.[0]?.id
      );
      this._setRowItems(
        this._zoneRow2,
        this._zones,
        'Zona alternativa 1',
        this._currentConfig.zonas_pronostico?.[1]?.id
      );
      this._setRowItems(
        this._zoneRow3,
        this._zones,
        'Zona alternativa 2',
        this._currentConfig.zonas_pronostico?.[2]?.id
      );

      this._loading = false;
      this._statusRow.set_subtitle('Listas cargadas desde INUMET. La configuración se guarda automáticamente.');
      this._saveConfig();
    } catch (e) {
      console.error(`weather-inumet prefs: ${e}`);

      this._loading = false;
      this._statusRow.set_subtitle(
        'No se pudieron descargar estaciones o zonas. Se usarán solo los valores del config actual.'
      );

      this._fallbackRowsFromConfigOnly();
    }
  }

  _fallbackRowsFromConfigOnly() {
    const stationItems = (this._currentConfig.estaciones || []).map(item => ({
      id: Number(item.id),
      label: this._stationLabel(item),
      raw: item,
    }));

    const zoneItems = (this._currentConfig.zonas_pronostico || []).map(item => ({
      id: Number(item.id),
      label: this._zoneLabel(item),
      raw: item,
    }));

    this._stations = stationItems;
    this._zones = zoneItems;

    this._setRowItems(this._stationRow1, stationItems, 'Estación principal', this._currentConfig.estaciones?.[0]?.id);
    this._setRowItems(this._stationRow2, stationItems, 'Estación alternativa 1', this._currentConfig.estaciones?.[1]?.id);
    this._setRowItems(this._stationRow3, stationItems, 'Estación alternativa 2', this._currentConfig.estaciones?.[2]?.id);

    this._setRowItems(this._zoneRow1, zoneItems, 'Zona principal', this._currentConfig.zonas_pronostico?.[0]?.id);
    this._setRowItems(this._zoneRow2, zoneItems, 'Zona alternativa 1', this._currentConfig.zonas_pronostico?.[1]?.id);
    this._setRowItems(this._zoneRow3, zoneItems, 'Zona alternativa 2', this._currentConfig.zonas_pronostico?.[2]?.id);
  }

  _setRowItems(row, items, emptySubtitle, selectedId) {
    const labels = items.map(item => item.label);
    row.model = Gtk.StringList.new(labels);
    row._items = items;

    if (!items.length) {
      row.subtitle = emptySubtitle;
      row.selected = Gtk.INVALID_LIST_POSITION;
      return;
    }

    const idx = items.findIndex(item => Number(item.id) === Number(selectedId));
    row.selected = idx >= 0 ? idx : 0;
    row.subtitle = '';
  }

  _applySelectionFromConfig() {
    const stationIds = (this._currentConfig.estaciones || []).map(item => Number(item.id));
    const zoneIds = (this._currentConfig.zonas_pronostico || []).map(item => Number(item.id));

    this._loading = true;

    this._selectRowById(this._stationRow1, stationIds[0]);
    this._selectRowById(this._stationRow2, stationIds[1]);
    this._selectRowById(this._stationRow3, stationIds[2]);

    this._selectRowById(this._zoneRow1, zoneIds[0]);
    this._selectRowById(this._zoneRow2, zoneIds[1]);
    this._selectRowById(this._zoneRow3, zoneIds[2]);

    this._stationBarrio1.set_text(this._currentConfig.estaciones?.[0]?.barrio ?? '');
    this._stationBarrio2.set_text(this._currentConfig.estaciones?.[1]?.barrio ?? '');
    this._stationBarrio3.set_text(this._currentConfig.estaciones?.[2]?.barrio ?? '');

    this._loading = false;
  }

  _selectRowById(row, id) {
    if (!row._items || !row._items.length)
      return;

    const idx = row._items.findIndex(item => Number(item.id) === Number(id));
    row.selected = idx >= 0 ? idx : 0;
  }

  _getSelectedItem(row) {
    if (!row._items || !row._items.length)
      return null;

    const idx = row.selected;
    if (idx < 0 || idx >= row._items.length)
      return null;

    return row._items[idx];
  }

  _saveConfig() {
    try {
      const station1 = this._getSelectedItem(this._stationRow1);
      const station2 = this._getSelectedItem(this._stationRow2);
      const station3 = this._getSelectedItem(this._stationRow3);

      const zone1 = this._getSelectedItem(this._zoneRow1);
      const zone2 = this._getSelectedItem(this._zoneRow2);
      const zone3 = this._getSelectedItem(this._zoneRow3);

      const estaciones = [
        [station1, this._stationBarrio1.get_text().trim()],
        [station2, this._stationBarrio2.get_text().trim()],
        [station3, this._stationBarrio3.get_text().trim()],
      ]
        .filter(([item]) => Boolean(item))
        .map(([item, barrio]) => ({
          id: Number(item.id),
          ciudad: item.raw.ciudad ?? '',
          barrio,
        }));

      const zonas_pronostico = [zone1, zone2, zone3]
        .filter(Boolean)
        .map(item => ({
          id: Number(item.id),
          nombre: item.raw.nombre ?? '',
        }));

      GLib.mkdir_with_parents(this._configDir, 0o755);

      const data = {
        estaciones,
        zonas_pronostico,
      };

      const ok = GLib.file_set_contents(
        this._userConfigPath,
        JSON.stringify(data, null, 2) + '\n'
      );

      if (ok) {
        this._statusRow.set_subtitle(`Configuración guardada en ${this._userConfigPath}`);
        this._currentConfig = data;
      } else {
        this._statusRow.set_subtitle('No se pudo guardar la configuración.');
      }
    } catch (e) {
      console.error(`weather-inumet prefs save: ${e}`);
      this._statusRow.set_subtitle(`Error al guardar: ${e.message}`);
    }
  }

  _loadInitialConfig() {
    const user = this._readJsonFile(this._userConfigPath);
    if (user)
      return user;

    const bundled = this._readJsonFile(this._defaultConfigPath);
    if (bundled)
      return bundled;

    return {
      estaciones: [],
      zonas_pronostico: [],
    };
  }

  _readJsonFile(path) {
    try {
      const file = Gio.File.new_for_path(path);
      if (!file.query_exists(null))
        return null;

      const [ok, bytes] = file.load_contents(null);
      if (!ok)
        return null;

      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      console.error(`weather-inumet prefs readJsonFile ${path}: ${e}`);
      return null;
    }
  }

  async _fetchStations() {
    const jsonStations = await this._fetchJson(URL_ESTACIONES);
    const stations = Array.isArray(jsonStations?.estaciones) ? jsonStations.estaciones : [];

    const jsonEstado = await this._fetchJson(URL_ESTADO_ACTUAL);
    const activeIds = new Set(
      (jsonEstado?.estaciones || []).map(item => Number(item.id))
    );

    const mapped = stations
      .filter(item => activeIds.has(Number(item.id)))
      .map(item => {
        const id = Number(item.id);

        const departamento = firstString(item, ['Departamento', 'departamento'], '');
        const nombre = firstString(item, ['NombreEstacion', 'nombreEstacion', 'nombre', 'Nombre'], '');

        const label = departamento && nombre
          ? `${departamento}, ${nombre}`
          : (nombre || departamento || `Estación ${id}`);

        return {
          id,
          label,
          raw: {
            id,
            ciudad: departamento,
            barrio: '',
            _comentario: '',
          },
        };
      });

    return uniqueById(mapped).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }

  async _fetchZones() {
    const json = await this._fetchJson(URL_PRONOSTICO);
    const items = Array.isArray(json?.items) ? json.items : [];

    const mapped = items.map(item => {
      const id = Number(firstString(item, ['zonaId', 'zona_id', 'id'], '0'));
      const nombre = firstString(item, ['zonaLarga', 'zona', 'nombre'], `Zona ${id}`);

      return {
        id,
        label: nombre,
        raw: {
          id,
          nombre,
          _comentario: '',
        },
      };
    });

    return uniqueById(mapped).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }

  async _fetchJson(url) {
    const session = new Soup.Session();
    const message = Soup.Message.new('GET', url);

    const bytes = await new Promise((resolve, reject) => {
      session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, result) => {
        try {
          const data = sess.send_and_read_finish(result);
          resolve(data);
        } catch (e) {
          reject(e);
        }
      });
    });

    const text = new TextDecoder().decode(bytes.toArray());
    return JSON.parse(text);
  }

  _stationLabel(item) {
    const ciudad = item?.ciudad ?? '';
    const barrio = item?.barrio ?? '';

    if (ciudad && barrio)
      return `${ciudad}, ${barrio}`;

    if (barrio)
      return barrio;

    if (ciudad)
      return ciudad;

    return `Estación ${Number(item?.id ?? 0)}`;
  }

  _zoneLabel(item) {
    const nombre = item?.nombre ?? '';
    return nombre || `Zona ${Number(item?.id ?? 0)}`;
  }
}