import { Link as RouterLink } from 'react-router'
import { Layout, MainNav } from '../components/Layout'
import { DeleteConfirm } from './DeleteConfirm'

// アカウントの削除（F-07）
export function DeleteAccountPage() {
  return (
    <Layout title="アカウントの削除" headerEnd={<MainNav />}>
      <DeleteConfirm
        mode="account"
        before={(
          <p>
            記録を手元に残したいときは、先に
            <RouterLink to="/settings/csv" className="text-blue-1000 underline underline-offset-[calc(3/16*1rem)] hover:decoration-[calc(3/16*1rem)] focus-visible:rounded-4 focus-visible:bg-yellow-300 focus-visible:outline focus-visible:outline-4 focus-visible:outline-black">
              CSV に書き出して
            </RouterLink>
            ください。
          </p>
        )}
      />
    </Layout>
  )
}
