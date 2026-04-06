/**
 * IconProvider — semantic icon map.
 * All Lucide imports live here. Components use getIcon() — never import Lucide directly.
 * This decouples icon names from the library and allows pack swaps without touching components.
 *
 * Usage:
 *   const getIcon = useIcon();
 *   getIcon('dashboard', { size: 15 })   // default size: 18
 */
import { createContext, useContext } from 'react';
import {
  LayoutDashboard,
  Settings,
  Users,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search,
  X,
  Plus,
  Pencil,
  Trash2,
  Check,
  AlertCircle,
  AlertTriangle,
  Info,
  Loader2,
  RefreshCw,
  Download,
  Upload,
  Eye,
  EyeOff,
  Copy,
  ExternalLink,
  Mail,
  Lock,
  Unlock,
  Shield,
  Activity,
  BarChart2,
  LineChart,
  Bot,
  Cpu,
  Zap,
  Globe,
  FileText,
  Database,
  Server,
  Wrench,
  Menu,
  MessageSquare,
  Send,
  Mic,
  Volume2,
  Pause,
  Play,
  Bookmark,
  Star,
  Clock,
  Calendar,
  Tag,
  Filter,
  SortAsc,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  CheckCircle,
  XCircle,
  ToggleLeft,
  ToggleRight,
  Layers,
  Package,
  Hash,
  TrendingUp,
  BookOpen,
} from 'lucide-react';

const semanticMap = {
  // Navigation
  dashboard: LayoutDashboard,
  settings: Settings,
  users: Users,
  logout: LogOut,
  menu: Menu,

  // Chevrons
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,

  // Actions
  search: Search,
  close: X,
  x: X,
  plus: Plus,
  add: Plus,
  edit: Pencil,
  delete: Trash2,
  trash: Trash2,
  check: Check,
  copy: Copy,
  download: Download,
  upload: Upload,
  refresh: RefreshCw,
  'external-link': ExternalLink,

  // Status
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  loading: Loader2,
  success: CheckCircle,
  'x-circle': XCircle,
  'check-circle': CheckCircle,

  // Visibility
  eye: Eye,
  'eye-off': EyeOff,

  // Auth & security
  mail: Mail,
  lock: Lock,
  unlock: Unlock,
  shield: Shield,

  // Data & analytics
  activity: Activity,
  'bar-chart': BarChart2,
  'line-chart': LineChart,
  'trending-up': TrendingUp,
  database: Database,

  // AI & platform
  bot: Bot,
  cpu: Cpu,
  zap: Zap,
  globe: Globe,
  server: Server,
  tool: Wrench,
  layers: Layers,
  package: Package,

  // Content
  'file-text': FileText,
  'book-open': BookOpen,
  'message-square': MessageSquare,
  send: Send,
  mic: Mic,
  volume: Volume2,
  pause: Pause,
  play: Play,
  bookmark: Bookmark,
  star: Star,

  // Time
  clock: Clock,
  calendar: Calendar,

  // Organisation
  tag: Tag,
  filter: Filter,
  sort: SortAsc,
  hash: Hash,

  // Arrows
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,

  // Toggle
  'toggle-on': ToggleRight,
  'toggle-off': ToggleLeft,
};

const IconContext = createContext(null);

export function IconProvider({ children }) {
  return (
    <IconContext.Provider value={semanticMap}>
      {children}
    </IconContext.Provider>
  );
}

export function useIcon() {
  const map = useContext(IconContext);
  return (name, props = {}) => {
    const Icon = map?.[name];
    if (!Icon) {
      console.warn(`[IconProvider] Unknown icon: "${name}"`);
      return null;
    }
    const { size = 18, ...rest } = props;
    return <Icon size={size} {...rest} />;
  };
}
