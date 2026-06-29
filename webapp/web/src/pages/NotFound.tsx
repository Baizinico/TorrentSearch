import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="max-w-content mx-auto px-6 py-24 text-center">
      <div className="font-display text-6xl font-bold text-accent mb-4">404</div>
      <p className="text-fg-muted mb-6">页面不存在</p>
      <Link to="/" className="btn-primary">
        <Home className="w-4 h-4" />
        返回首页
      </Link>
    </div>
  );
}
