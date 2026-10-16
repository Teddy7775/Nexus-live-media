import fs from 'node:fs/promises';
import { slugifyEvent } from './store.js';
import { mergeKey, validateKey } from './greenscreen.js';

/**
 * Settings the operator can change while the booth is running. They are saved next to the app
 * (runtime-settings.json) and layered on top of config.json, so config.json is never rewritten.
 */
export class RuntimeSettings {
  constructor({ config, templates, file, backgrounds = null }) {
    this.templates = templates;
    this.file = file;
    this.backgrounds = backgrounds; // null when green screen is off
    this.values = {
      activeTemplate: config.activeTemplate,
      eventName: config.event.name,
      eventSlug: config.event.slug,
      printEnabled: config.printer.enabled,
      copies: config.printer.copies,
      // Green screen: how the green is judged, and which background everyone gets ("guest" = they choose).
      key: { ...config.greenScreen.key },
      backdrop: config.greenScreen.defaultBackdrop,
    };
    // A configured background that does not exist (typo, deleted file) must not strand every guest.
    if (backgrounds && this.values.backdrop !== 'guest' && !backgrounds.has(this.values.backdrop)) this.values.backdrop = 'guest';
  }

  async load() {
    let saved;
    try {
      saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {
      return this;
    }
    // Ignore anything that no longer makes sense (e.g. a template that was deleted).
    if (typeof saved.activeTemplate === 'string' && this.templates.has(saved.activeTemplate)) this.values.activeTemplate = saved.activeTemplate;
    if (typeof saved.eventName === 'string' && saved.eventName.trim()) this.values.eventName = saved.eventName.trim();
    if (typeof saved.eventSlug === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(saved.eventSlug)) this.values.eventSlug = saved.eventSlug;
    if (typeof saved.printEnabled === 'boolean') this.values.printEnabled = saved.printEnabled;
    if (Number.isInteger(saved.copies) && saved.copies >= 1 && saved.copies <= 10) this.values.copies = saved.copies;
    if (saved.key && validateKey(saved.key).length === 0) this.values.key = { ...saved.key };
    if (saved.backdrop === 'guest' || (typeof saved.backdrop === 'string' && this.backgrounds?.has(saved.backdrop))) this.values.backdrop = saved.backdrop;
    return this;
  }

  get activeTemplate() {
    return this.templates.get(this.values.activeTemplate);
  }

  get eventName() {
    return this.values.eventName;
  }

  get eventSlug() {
    return this.values.eventSlug;
  }

  get printEnabled() {
    return this.values.printEnabled;
  }

  get copies() {
    return this.values.copies;
  }

  get key() {
    return this.values.key;
  }

  get backdrop() {
    return this.values.backdrop;
  }

  /** Returns a list of problems; applies nothing unless the whole patch is valid. */
  validate(patch) {
    const problems = [];
    if (patch.activeTemplate !== undefined && !this.templates.has(patch.activeTemplate)) problems.push(`Unknown template "${patch.activeTemplate}"`);
    if (patch.eventName !== undefined && (typeof patch.eventName !== 'string' || !patch.eventName.trim() || patch.eventName.length > 80)) problems.push('Event name must be 1-80 characters');
    if (patch.printEnabled !== undefined && typeof patch.printEnabled !== 'boolean') problems.push('printEnabled must be true or false');
    if (patch.copies !== undefined && !(Number.isInteger(patch.copies) && patch.copies >= 1 && patch.copies <= 10)) problems.push('Copies must be a whole number from 1 to 10');
    if (patch.key !== undefined) problems.push(...(this.backgrounds ? (mergeKey(this.values.key, patch.key).problems ?? []) : ['Green screen is not turned on (greenScreen.enabled in config.json)']));
    if (patch.backdrop !== undefined && !(patch.backdrop === 'guest' || (typeof patch.backdrop === 'string' && this.backgrounds?.has(patch.backdrop)))) problems.push(`Unknown background "${patch.backdrop}"`);
    return problems;
  }

  async update(patch, now = new Date()) {
    const problems = this.validate(patch);
    if (problems.length) return { ok: false, problems };
    if (patch.activeTemplate !== undefined) this.values.activeTemplate = patch.activeTemplate;
    if (patch.printEnabled !== undefined) this.values.printEnabled = patch.printEnabled;
    if (patch.copies !== undefined) this.values.copies = patch.copies;
    if (patch.key !== undefined) this.values.key = mergeKey(this.values.key, patch.key).key;
    if (patch.backdrop !== undefined) this.values.backdrop = patch.backdrop;
    if (patch.eventName !== undefined && patch.eventName.trim() !== this.values.eventName) {
      this.values.eventName = patch.eventName.trim();
      // A new event name starts a new photo folder, so events never mix.
      this.values.eventSlug = slugifyEvent(this.values.eventName, now);
    }
    await fs.writeFile(this.file, JSON.stringify(this.values, null, 2));
    return { ok: true };
  }
}
