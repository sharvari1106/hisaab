import { redirect } from 'next/navigation';

// middleware.js redirects "/" to the right home page for the logged-in role
export default function Home() {
  redirect('/login');
}
