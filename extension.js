import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

function safe(v, d = '--') {
  if (v === null || v === undefined)
    return d;

  const s = String(v).trim();
  return s !== '' ? s : d;
}

function setIcon(actor, path) {
  if (!path)
    return;

  try {
    actor.gicon = Gio.icon_new_for_string(path);
  } catch (e) {
    console.error(`weather-inumet: error cargando icono ${path}: ${e}`);
  }
}

function norm(s) {
  return safe(s, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function subgroups(block) {
  return Array.isArray(block?.subgrupos) ? block.subgrupos : [];
}

function findSubgroup(block, patterns) {
  const items = subgroups(block);

  for (const pat of patterns) {
    const found = items.find(item => norm(item.subgrupo).includes(norm(pat)));
    if (found)
      return found;
  }

  return items[0] || null;
}

function getMorningSubgroup(block) {
  return findSubgroup(block, ['mañana', 'manana']);
}

function getNightSubgroup(block) {
  return findSubgroup(block, ['tarde/noche', 'noche', 'tarde']);
}

function buildForecastText(item, block) {
  if (!item)
    return safe(block?.grupo);

  const parts = [
    safe(item.descripcion, ''),
    safe(item.evolucion, ''),
    safe(item.descripcionExtra, ''),
  ].filter(Boolean);

  if (parts.length > 0)
    return parts[0];

  return safe(block?.grupo);
}

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
  _init(extension, extensionPath) {
    super._init(0.0, 'Weather');

    this._extension = extension;
    this._extensionPath = extensionPath;
    this._weatherScript = GLib.build_filenamev([
      this._extensionPath,
      'data',
      'weather.inumet.py',
    ]);

    this._panelBox = new St.BoxLayout({
      style_class: 'panel-status-menu-box',
    });

    this._panelIcon = new St.Icon({
      icon_name: 'weather-overcast-symbolic',
      style_class: 'system-status-icon',
    });

    this._panelLabel = new St.Label({
      text: '--°',
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._panelBox.add_child(this._panelIcon);
    this._panelBox.add_child(this._panelLabel);
    this.add_child(this._panelBox);

    this._root = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });

    this._card = new St.BoxLayout({
      vertical: true,
      style_class: 'weather-card',
    });

    this._root.add_child(this._card);
    this.menu.addMenuItem(this._root);

    this._place = new St.Label({
      text: '...',
      style_class: 'weather-title',
    });

    this._card.add_child(this._place);

    this._separator();

    this._hero = new St.BoxLayout({
      style_class: 'weather-hero',
    });

    this._heroIcon = new St.Icon({
      icon_name: 'weather-overcast-symbolic',
      style_class: 'weather-hero-icon',
    });

    this._heroCenter = new St.BoxLayout({
      vertical: true,
      style_class: 'weather-hero-center',
    });

    this._now = new St.Label({
      text: 'Ahora',
      style_class: 'weather-now',
    });

    this._temp = new St.Label({
      text: '🌡️ --°',
      style_class: 'weather-temp',
    });

    this._status = new St.Label({
      text: '--',
      style_class: 'weather-status',
    });

    this._heroCenter.add_child(this._now);
    this._heroCenter.add_child(this._temp);
    this._heroCenter.add_child(this._status);

    this._heroRight = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: 'weather-hero-right',
    });

    this._minmax = new St.Label({
      text: '↓ --°  ↑ --°',
      style_class: 'weather-minmax',
    });

    this._hum = new St.Label({
      text: '💧 --%',
      style_class: 'weather-side-item',
    });

    this._sunrise = new St.Label({
      text: '☀️ --:--',
      style_class: 'weather-side-item',
    });

    this._sunset = new St.Label({
      text: '🌙 --:--',
      style_class: 'weather-side-item',
    });

    this._heroRight.add_child(this._minmax);
    this._heroRight.add_child(this._hum);
    this._heroRight.add_child(this._sunrise);
    this._heroRight.add_child(this._sunset);

    this._hero.add_child(this._heroIcon);
    this._hero.add_child(this._heroCenter);
    this._hero.add_child(this._heroRight);

    this._card.add_child(this._hero);

    this._separator();

    this._nightBlock = new St.BoxLayout({
      style_class: 'weather-night-block',
      x_expand: true,
    });

    this._nightLeft = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: 'weather-night-left',
    });

    this._nightTitle = new St.Label({
      text: 'Esta noche',
      style_class: 'weather-section-title',
    });

    this._nightDesc = new St.Label({
      text: '--',
      style_class: 'weather-night-text',
    });

    this._nightIcon = new St.Icon({
      icon_name: 'weather-overcast-symbolic',
      icon_size: 72,
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._nightLeft.add_child(this._nightTitle);
    this._nightLeft.add_child(this._nightDesc);

    this._nightBlock.add_child(this._nightLeft);
    this._nightBlock.add_child(this._nightIcon);

    this._card.add_child(this._nightBlock);

    this._separator();

    this._f24Title = new St.Label({
      text: 'Pronóstico 24 hs',
      style_class: 'weather-section-title',
    });

    this._f24Line = this._forecastLine();

    this._card.add_child(this._f24Title);
    this._card.add_child(this._f24Line.box);

    this._separator();

    this._f48Title = new St.Label({
      text: 'Pronóstico 48 hs',
      style_class: 'weather-section-title',
    });

    this._f48Line = this._forecastLine();

    this._card.add_child(this._f48Title);
    this._card.add_child(this._f48Line.box);

    this._separator();

    this._actionsItem = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    });

    this._actionsRow = new St.BoxLayout({
      x_expand: true,
      style: 'spacing: 12px;',
    });

    this._refreshButton = this._buildActionButton(
      'view-refresh-symbolic',
      'Actualizar',
      () => this._refresh(true)
    );

    this._prefsButton = this._buildActionButton(
      'preferences-system-symbolic',
      'Configuración',
      () => this._openPreferences()
    );

    this._actionsRow.add_child(this._refreshButton);
    this._actionsRow.add_child(this._prefsButton);
    this._actionsItem.add_child(this._actionsRow);
    this.menu.addMenuItem(this._actionsItem);

    this._refreshTimeoutId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      600,
      () => {
        this._refresh(false);
        return GLib.SOURCE_CONTINUE;
      }
    );

    this._refresh(false);
  }

  _buildActionButton(iconName, labelText, callback) {
    const button = new St.Button({
      x_expand: true,
      can_focus: true,
      reactive: true,
      track_hover: true,
      style_class: 'button',
    });

    const box = new St.BoxLayout({
      x_expand: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      style: 'spacing: 8px; padding: 8px 12px;',
    });

    const icon = new St.Icon({
      icon_name: iconName,
      style_class: 'popup-menu-icon',
      y_align: Clutter.ActorAlign.CENTER,
    });

    const label = new St.Label({
      text: labelText,
      y_align: Clutter.ActorAlign.CENTER,
    });

    box.add_child(icon);
    box.add_child(label);
    button.set_child(box);

    button.connect('clicked', callback);

    return button;
  }

  _openPreferences() {
    try {
      this.menu.close();
      this._extension.openPreferences();
    } catch (e) {
      console.error(`weather-inumet: no se pudo abrir preferencias: ${e}`);
    }
  }

  _separator() {
    this._card.add_child(new St.BoxLayout({
      style_class: 'weather-separator',
    }));
  }

  _forecastLine() {
    const box = new St.BoxLayout({
      style_class: 'weather-forecast-line',
    });

    const icon = new St.Icon({
      icon_name: 'weather-overcast-symbolic',
      icon_size: 22,
      y_align: Clutter.ActorAlign.START,
    });

    const mm = new St.Label({
      text: '↓ --° ↑ --°',
      y_align: Clutter.ActorAlign.START,
      style_class: 'weather-forecast-mm',
    });

    const day = new St.Label({
      text: '☀️ --',
      x_expand: true,
      y_align: Clutter.ActorAlign.START,
      style_class: 'weather-forecast-side',
    });

    const night = new St.Label({
      text: '🌙 --',
      x_expand: true,
      y_align: Clutter.ActorAlign.START,
      style_class: 'weather-forecast-side',
    });

    box.add_child(icon);
    box.add_child(mm);
    box.add_child(day);
    box.add_child(night);

    return {box, icon, mm, day, night};
  }

  _refresh(force) {
    const argv = [this._weatherScript];
    if (force)
      argv.push('--force');

    const proc = Gio.Subprocess.new(
      argv,
      Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
    );

    proc.communicate_utf8_async(null, null, (p, res) => {
      try {
        const [, out, err] = p.communicate_utf8_finish(res);
        if (err && err.trim() !== '')
          console.error(`weather-inumet stderr: ${err}`);

        const data = JSON.parse(out);
        this._apply(data);
      } catch (e) {
        console.error(`weather-inumet: _refresh() failed: ${e}`);
      }
    });
  }

  _apply(d) {
    const t = safe(d.temperatura);
    const today = d.pronostico_hoy || {};
    const p24 = d.pronostico_24hs || {};
    const p48 = d.pronostico_48hs || {};
    const zona = safe(d.zonaPronostico, '');

    this._panelLabel.set_text(`${t}°`);
    setIcon(this._panelIcon, d.icono);

    this._place.set_text(safe(d.localidad));

    this._temp.set_text(`🌡️ ${t}°`);
    this._status.set_text(safe(d.textotiempo || d.cielo));
    this._minmax.set_text(`↓ ${safe(today.tempMin)}°  ↑ ${safe(today.tempMax)}°`);
    setIcon(this._heroIcon, d.icono);

    this._hum.set_text(`💧 ${safe(d.humedad)}%`);
    this._sunrise.set_text(`☀️ ${safe(d.salidasol)}`);
    this._sunset.set_text(`🌙 ${safe(d.puestasol)}`);

    const tn = getNightSubgroup(today);
    this._nightDesc.set_text(buildForecastText(tn, today));
    setIcon(this._nightIcon, tn?.icono || today?.icono);

    this._applyForecast(p24, this._f24Line);
    this._applyForecast(p48, this._f48Line);

    this._f24Title.set_text(
      zona ? `Pronóstico 24 hs (${zona})` : 'Pronóstico 24 hs'
    );

    this._f48Title.set_text(
      zona ? `Pronóstico 48 hs (${zona})` : 'Pronóstico 48 hs'
    );    
  }

  _applyForecast(block, line) {
    line.mm.set_text(`↓ ${safe(block?.tempMin)}°  ↑ ${safe(block?.tempMax)}°`);
    setIcon(line.icon, block?.icono);

    const m = getMorningSubgroup(block);
    const n = getNightSubgroup(block);

    line.day.set_text(`☀️ ${buildForecastText(m, block)}`);
    line.night.set_text(`🌙 ${buildForecastText(n, block)}`);
  }

  destroy() {
    if (this._refreshTimeoutId) {
      GLib.source_remove(this._refreshTimeoutId);
      this._refreshTimeoutId = null;
    }

    super.destroy();
  }
  
});

export default class WeatherExtension extends Extension {
  enable() {
    this._startupSignal = Main.layoutManager.connect(
      'startup-complete',
      () => Main.overview.hide()
    );

    this._indicator = new Indicator(this, this.path);
    Main.panel.addToStatusArea(this.uuid, this._indicator);
  }

  disable() {
    if (this._startupSignal) {
      Main.layoutManager.disconnect(this._startupSignal);
      this._startupSignal = null;
    }

    this._indicator?.destroy();
    this._indicator = null;
  }
}
