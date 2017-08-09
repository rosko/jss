import {create, sheets} from 'jss'

const styles = {
  a: {color: 'red'},
  a1: {color: 'red'},
  a2: {color: 'red'},
  a3: {color: 'red'},
  a4: {color: 'red'}
}

suite.only('Create linked sheet', () => {
  benchmark('without linking', function benchmark() {
    create()
      .createStyleSheet(styles)
      .attach()
      .detach()
  })

  benchmark('without escaping', function benchmark() {
    create()
      .createStyleSheet(styles, {link: true})
      .attach()
      .detach()
  })

  benchmark('with escaping', function benchmark() {
    create()
      .createStyleSheet(styles, {link: true, supportEscaping: true})
      .attach()
      .detach()
  })
})
