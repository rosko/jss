/* @flow */
import warning from 'warning'
import sheets from '../sheets'
import type StyleSheet from '../StyleSheet'
import type {Rule, InsertionPoint} from '../types'

type PriorityOptions = {
  index: number,
  insertionPoint?: InsertionPoint
}

/**
 * Get a style property.
 */
function getStyle(cssRule: HTMLElement|CSSStyleRule, prop: string): string {
  try {
    return cssRule.style.getPropertyValue(prop)
  }
  catch (err) {
    // IE may throw if property is unknown.
    return ''
  }
}

/**
 * Set a style property.
 */
function setStyle(cssRule: HTMLElement|CSSStyleRule, prop: string, value: string): boolean {
  try {
    cssRule.style.setProperty(prop, value)
  }
  catch (err) {
    // IE may throw if property is unknown.
    return false
  }
  return true
}

function extractSelector(cssText: string, from: number = 0) {
  return cssText.substr(from, cssText.indexOf('{') - 1)
}

const CSSRuleTypes = {
  STYLE_RULE: 1,
  KEYFRAMES_RULE: 7
}

/**
 * Get the selector.
 */
function getSelector(cssRule: CSSOMRule): string {
  if (cssRule.type === CSSRuleTypes.STYLE_RULE) return cssRule.selectorText
  if (cssRule.type === CSSRuleTypes.KEYFRAMES_RULE) {
    const {name} = cssRule
    if (name) return `@keyframes ${name}`

    // There is no rule.name in the following browsers:
    // - IE 9
    // - Safari 7.1.8
    // - Mobile Safari 9.0.0
    const {cssText} = cssRule
    return `@${extractSelector(cssText, cssText.indexOf('keyframes'))}`
  }

  return extractSelector(cssRule.cssText)
}

/**
 * Set the selector.
 */
function setSelector(cssRule: CSSStyleRule, selectorText: string): boolean {
  cssRule.selectorText = selectorText

  // Return false if setter was not successful.
  // Currently works in chrome only.
  return cssRule.selectorText === selectorText
}

/**
 * Gets the `head` element upon the first call and caches it.
 */
const getHead = (() => {
  let head
  return (): HTMLElement => {
    if (!head) head = document.head || document.getElementsByTagName('head')[0]
    return head
  }
})()

const getUnescapedSelectorsMap = (() => {
  const style = document.createElement('style')
  const head = getHead()

  return (rules) => {
    const map = {}
    head.appendChild(style)
    for (let i = 0; i < rules.length; i++) {
      const {selector} = rules[i]
      style.textContent = `${selector} {}`
      map[getSelector(style.sheet.cssRules[0])] = selector
    }
    head.removeChild(style)
    return map
  }
})()

/**
 * Find attached sheet with an index higher than the passed one.
 */
function findHigherSheet(registry: Array<StyleSheet>, options: PriorityOptions): StyleSheet|null {
  for (let i = 0; i < registry.length; i++) {
    const sheet = registry[i]
    if (
      sheet.attached &&
      sheet.options.index > options.index &&
      sheet.options.insertionPoint === options.insertionPoint
    ) {
      return sheet
    }
  }
  return null
}

/**
 * Find attached sheet with the highest index.
 */
function findHighestSheet(registry: Array<StyleSheet>, options: PriorityOptions): StyleSheet|null {
  for (let i = registry.length - 1; i >= 0; i--) {
    const sheet = registry[i]
    if (sheet.attached && sheet.options.insertionPoint === options.insertionPoint) {
      return sheet
    }
  }
  return null
}

/**
 * Find a comment with "jss" inside.
 */
function findCommentNode(text: string): Comment|null {
  const head = getHead()
  for (let i = 0; i < head.childNodes.length; i++) {
    const node = head.childNodes[i]
    if (node.nodeType === 8 && node.nodeValue.trim() === text) {
      return node
    }
  }
  return null
}

/**
 * Find a node before which we can insert the sheet.
 */
function findPrevNode(options: PriorityOptions): ?Node|null {
  const {registry} = sheets

  if (registry.length > 0) {
    // Try to insert before the next higher sheet.
    let sheet = findHigherSheet(registry, options)
    if (sheet) return sheet.renderer.element

    // Otherwise insert after the last attached.
    sheet = findHighestSheet(registry, options)
    if (sheet) return sheet.renderer.element.nextElementSibling
  }

  // Try to find a comment placeholder if registry is empty.
  const {insertionPoint} = options
  if (insertionPoint && typeof insertionPoint === 'string') {
    const comment = findCommentNode(insertionPoint)
    if (comment) return comment.nextSibling
    // If user specifies an insertion point and it can't be found in the document -
    // bad specificity issues may appear.
    warning(insertionPoint === 'jss', '[JSS] Insertion point "%s" not found.', insertionPoint)
  }

  return null
}

/**
 * Insert style element into the DOM.
 */
function insertStyle(style: HTMLElement, options: PriorityOptions) {
  const {insertionPoint} = options
  const prevNode = findPrevNode(options)

  if (prevNode) {
    const {parentNode} = prevNode
    if (parentNode) parentNode.insertBefore(style, prevNode)
    return
  }

  // Works with iframes and any node types.
  if (insertionPoint && typeof insertionPoint.nodeType === 'number') {
    // https://stackoverflow.com/questions/41328728/force-casting-in-flow
    const insertionPointElement: HTMLElement = (insertionPoint: any)
    const {parentNode} = insertionPointElement
    if (parentNode) parentNode.insertBefore(style, insertionPointElement.nextSibling)
    else warning(false, '[JSS] Insertion point is not in the DOM.')
    return
  }

  getHead().insertBefore(style, prevNode)
}

export default class DomRenderer {
  getStyle = getStyle

  setStyle = setStyle

  setSelector = setSelector

  getSelector = getSelector

  getUnescapedSelectorsMap = getUnescapedSelectorsMap

  // HTMLStyleElement needs fixing https://github.com/facebook/flow/issues/2696
  element: any

  sheet: ?StyleSheet

  hasInsertedRules: boolean = false

  constructor(sheet?: StyleSheet) {
    // There is no sheet when the renderer is used from a standalone StyleRule.
    if (sheet) sheets.add(sheet)

    this.sheet = sheet
    const {media, meta, element} = (this.sheet ? this.sheet.options : {})
    this.element = element || document.createElement('style')
    this.element.type = 'text/css'
    this.element.setAttribute('data-jss', '')
    if (media) this.element.setAttribute('media', media)
    if (meta) this.element.setAttribute('data-meta', meta)
  }

  /**
   * Insert style element into render tree.
   */
  attach(): void {
    // In the case the element node is external and it is already in the DOM.
    if (this.element.parentNode || !this.sheet) return

    // When rules are inserted using `insertRule` API, after `sheet.detach().attach()`
    // browsers remove those rules.
    // TODO figure out if its a bug and if it is known.
    // Workaround is to redeploy the sheet before attaching as a string.
    if (this.hasInsertedRules) {
      this.deploy()
      this.hasInsertedRules = false
    }

    insertStyle(this.element, this.sheet.options)
  }

  /**
   * Remove style element from render tree.
   */
  detach(): void {
    this.element.parentNode.removeChild(this.element)
  }

  /**
   * Inject CSS string into element.
   */
  deploy(): void {
    if (!this.sheet) return
    this.element.textContent = `\n${this.sheet.toString()}\n`
  }

  /**
   * Insert a rule into element.
   */
  insertRule(rule: Rule, index?: number): false|CSSStyleRule {
    const {sheet} = this.element
    const {cssRules} = sheet
    const str = rule.toString()
    if (!index) index = cssRules.length

    if (!str) return false

    try {
      sheet.insertRule(str, index)
    }
    catch (err) {
      warning(false, '[JSS] Can not insert an unsupported rule \n\r%s', rule)
      return false
    }
    this.hasInsertedRules = true

    return cssRules[index]
  }

  /**
   * Delete a rule.
   */
  deleteRule(cssRule: CSSStyleRule): boolean {
    const {sheet} = this.element
    const index = this.indexOf(cssRule)
    if (index === -1) return false
    sheet.deleteRule(index)
    return true
  }

  /**
   * Get index of a CSS Rule.
   */
  indexOf(cssRule: CSSStyleRule): number {
    const {cssRules} = this.element.sheet
    for (let index = 0; index < cssRules.length; index++) {
      if (cssRule === cssRules[index]) return index
    }
    return -1
  }

  /**
   * Generate a new CSS rule and replace the existing one.
   */
  replaceRule(cssRule: CSSStyleRule, rule: Rule): false|CSSStyleRule {
    const index = this.indexOf(cssRule)
    const newCssRule = this.insertRule(rule, index)
    this.element.sheet.deleteRule(index)
    return newCssRule
  }

  /**
   * Get all rules elements.
   */
  getRules(): CSSRuleList {
    return this.element.sheet.cssRules
  }
}
