// 表示したときに 1 回だけその要素へ移る ref。モジュールの関数なので、描き直しのたびには呼ばれない
// （ref={(element) => element?.focus()} のように書くと、描き直すたびにフォーカスを奪ってしまう）
export function focusOnMount(element: HTMLElement | null): void {
  element?.focus()
}
