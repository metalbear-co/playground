"use client";

import { IPInfo } from "@/components/ipinfo"
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url, {
  method: 'GET',
}).then(res => {
  console.log(res);
  return res.json();
})


export default function Home() {
  const { data, error, isLoading } = useSWR("https://playground.metalbear.dev/count", fetcher)

  if (error) {
    console.log(error);
    return (<main className="flex min-h-screen flex-col items-center justify-between p-24 bg-gray-100"><div>failed to load</div></main>)
  }
  if (isLoading) return (<main className="flex min-h-screen flex-col items-center justify-between p-24 bg-gray-100"><div>loading...</div></main>)

  console.log
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24 bg-gray-100">
      <IPInfo ip={data.info.ip} count={data.count} text={data.text} name={data.info.name} demoMarker={data.demo_marker} />
    </main>
  )
}
