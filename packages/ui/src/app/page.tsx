import NetworkSupportChecker from './components/NetworkSupportChecker'
import StoreDashboard from './components/StoreDashboard'

export default function Home() {
  return (
    <>
      <NetworkSupportChecker />
      <div className="flex flex-grow flex-col items-center justify-center rounded-md p-3">
        <StoreDashboard />
      </div>
    </>
  )
}
