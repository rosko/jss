/* @flow */
import createRule from './utils/createRule'
import updateStyle from './utils/updateStyle'
import linkRule from './utils/linkRule'
import StyleRule from './rules/StyleRule'
import type {
  RuleListOptions,
  ToCssOptions,
  Rule,
  RuleOptions,
  JssStyle
} from './types'

/**
 * Contains rules objects and allows adding/removing etc.
 * Is used for e.g. by `StyleSheet` or `ConditionalRule`.
 */
export default class RuleList {
  // Rules registry for access by .get() method.
  // It contains the same rule registered by name and by selector.
  map: {[key: string]: Rule} = {}

  // Original styles object.
  raw: {[key: string]: JssStyle} = {}

  // Used to ensure correct rules order.
  index: Array<Rule> = []

  options: RuleListOptions

  classes: Object

  constructor(options: RuleListOptions) {
    this.options = options
    this.classes = options.classes
  }

  /**
   * Create and register rule.
   *
   * Will not render after Style Sheet was rendered the first time.
   */
  add(name: string, decl: JssStyle, options?: RuleOptions): Rule {
    const {parent, sheet, jss, Renderer, generateClassName} = this.options

    options = {
      classes: this.classes,
      parent,
      sheet,
      jss,
      Renderer,
      generateClassName,
      ...options
    }

    if (!options.selector && this.classes[name]) {
      options.selector = `.${this.classes[name]}`
    }

    this.raw[name] = decl

    const rule = createRule(name, decl, options)
    let className

    if (!options.selector && rule instanceof StyleRule) {
      className = generateClassName(rule, sheet)
      rule.selector = `.${className}`
    }

    this.register(rule, className)

    const index = options.index === undefined ? this.index.length : options.index
    this.index.splice(index, 0, rule)

    return rule
  }

  /**
   * Get a rule.
   */
  get(name: string): Rule {
    return this.map[name]
  }

  /**
   * Delete a rule.
   */
  remove(rule: Rule): void {
    this.unregister(rule)
    this.index.splice(this.indexOf(rule), 1)
  }

  /**
   * Get index of a rule.
   */
  indexOf(rule: Rule): number {
    return this.index.indexOf(rule)
  }

  /**
   * Run `onProcessRule()` plugins on every rule.
   */
  process(): void {
    const {plugins} = this.options.jss
    // We need to clone array because if we modify the index somewhere else during a loop
    // we end up with very hard-to-track-down side effects.
    this.index.slice(0).forEach(plugins.onProcessRule, plugins)
  }

  /**
   * Register a rule in `.map` and `.classes` maps.
   */
  register(rule: Rule, className?: string): void {
    this.map[rule.key] = rule
    if (rule instanceof StyleRule) {
      this.map[rule.selector] = rule
      if (className) this.classes[rule.key] = className
    }
  }

  /**
   * Unregister a rule.
   */
  unregister(rule: Rule): void {
    delete this.map[rule.key]
    if (rule instanceof StyleRule) {
      delete this.map[rule.selector]
      delete this.classes[rule.key]
    }
  }

  /**
   * Update the function values with a new data.
   */
  update(name?: string, data?: Object): void {
    if (typeof name === 'string') {
      updateStyle(this.get(name), data, RuleList)
      return
    }

    for (let index = 0; index < this.index.length; index++) {
      updateStyle(this.index[index], name, RuleList)
    }
  }

  /**
   * Link renderable rules with CSSRuleList.
   */
  link(cssRules: CSSRuleList): void {
    let map

    if (this.options.supportEscaping) {
      map = this.options.sheet.renderer.getUnescapedSelectorsMap(this.index)
    }

    for (let i = 0; i < cssRules.length; i++) {
      const cssRule = cssRules[i]
      let  selector = this.options.sheet.renderer.getSelector(cssRule)
      if (this.options.supportEscaping) {
        selector = map[selector]
      }
      const rule = this.map[selector]
      if (rule) linkRule(rule, cssRule)
    }
  }

  /**
   * Convert rules to a CSS string.
   */
  toString(options?: ToCssOptions): string {
    let str = ''

    for (let index = 0; index < this.index.length; index++) {
      const rule = this.index[index]
      const css = rule.toString(options)

      // No need to render an empty rule.
      if (!css) continue

      if (str) str += '\n'
      str += css
    }

    return str
  }
}
