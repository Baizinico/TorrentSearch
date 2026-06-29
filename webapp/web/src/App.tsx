import { Routes, Route } from 'react-router-dom';
import RootLayout from './layouts/RootLayout';
import Home from './pages/Home';
import Search from './pages/Search';
import Browse from './pages/Browse';
import Details from './pages/Details';
import Bookmarks from './pages/Bookmarks';
import Settings from './pages/Settings';
import Providers from './pages/settings/Providers';
import TorznabEdit from './pages/settings/TorznabEdit';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<Search />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/details" element={<Details />} />
        <Route path="/bookmarks" element={<Bookmarks />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/providers" element={<Providers />} />
        <Route path="/settings/providers/edit" element={<TorznabEdit />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
