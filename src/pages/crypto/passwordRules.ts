// 暗号化パスワードの決まり。総当たりで試されても破られにくいよう、ログインのパスワードより長くする
export const MIN_CRYPTO_PASSWORD = 10

export function validateNewCryptoPassword(password: string, confirmation: string): string | null {
  if ([...password].length < MIN_CRYPTO_PASSWORD) return `暗号化パスワードは ${MIN_CRYPTO_PASSWORD} 文字以上にしてください。`
  if (password !== confirmation) return '確認のために入力した暗号化パスワードが一致しません。'
  return null
}
