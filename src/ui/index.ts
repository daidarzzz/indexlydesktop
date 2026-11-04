/**
 * @file src/ui/index.ts
 * @description Biblioteca de componentes de IndexLy. Es la superficie pública
 * que consumen tanto la aplicación como los plugins.
 */

import { cn } from './cn';
import { mount, unmount } from './mount';
import { Button } from './components/Button';
import { IconButton } from './components/IconButton';
import { Field } from './components/Field';
import { Input, Select, Textarea } from './components/Input';
import { SearchInput } from './components/SearchInput';
import { Switch } from './components/Switch';
import { Checkbox } from './components/Checkbox';
import { Badge } from './components/Badge';
import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/Card';
import { Callout } from './components/Callout';
import { EmptyState } from './components/EmptyState';
import { Spinner } from './components/Spinner';
import { Kbd } from './components/Kbd';
import { Stat } from './components/Stat';
import { Divider } from './components/Divider';
import { Skeleton } from './components/Skeleton';
import { List, ListItem } from './components/List';
import { SegmentedControl, Tabs } from './components/Tabs';
import { Modal } from './components/Modal';
import { Grid, Inline, Stack } from './components/Layout';

export { cn } from './cn';
export { mount, unmount } from './mount';

export { Button } from './components/Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/Button';
export { IconButton } from './components/IconButton';
export type { IconButtonProps, IconButtonSize, IconButtonVariant } from './components/IconButton';
export { Field } from './components/Field';
export type { FieldControlProps, FieldProps } from './components/Field';
export { Input, Select, Textarea } from './components/Input';
export type { ControlSize, InputProps, SelectOption, SelectProps, TextareaProps } from './components/Input';
export { SearchInput } from './components/SearchInput';
export type { SearchInputProps } from './components/SearchInput';
export { Switch } from './components/Switch';
export type { SwitchProps } from './components/Switch';
export { Checkbox } from './components/Checkbox';
export type { CheckboxProps } from './components/Checkbox';
export { Badge } from './components/Badge';
export type { BadgeProps, BadgeVariant } from './components/Badge';
export {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/Card';
export type {
  CardHeaderProps,
  CardProps,
} from './components/Card';
export { Callout } from './components/Callout';
export type { CalloutProps, CalloutVariant } from './components/Callout';
export { EmptyState } from './components/EmptyState';
export type { EmptyStateProps, EmptyStateTone } from './components/EmptyState';
export { Spinner } from './components/Spinner';
export type { SpinnerProps, SpinnerSize } from './components/Spinner';
export { Kbd } from './components/Kbd';
export type { KbdProps } from './components/Kbd';
export { Stat } from './components/Stat';
export type { StatProps } from './components/Stat';
export { Divider } from './components/Divider';
export type { DividerProps } from './components/Divider';
export { Skeleton } from './components/Skeleton';
export type { SkeletonProps } from './components/Skeleton';
export { List, ListItem } from './components/List';
export type { ListItemProps, ListProps } from './components/List';
export { SegmentedControl, Tabs } from './components/Tabs';
export type { SegmentedControlProps, TabItem, TabsProps, TabsVariant } from './components/Tabs';
export { Modal } from './components/Modal';
export type { ModalProps, ModalSize } from './components/Modal';
export { Grid, Inline, Stack } from './components/Layout';
export type { GridProps, InlineProps, SpaceStep, StackProps } from './components/Layout';

/**
 * Objeto único para consumidores que prefieren namespaces
 * (`ui.Button`, `ui.mount`, …) en lugar de imports individuales.
 */
export const ui = {
  cn,
  mount,
  unmount,
  Button,
  IconButton,
  Field,
  Input,
  Textarea,
  Select,
  SearchInput,
  Switch,
  Checkbox,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardBody,
  CardFooter,
  Callout,
  EmptyState,
  Spinner,
  Kbd,
  Stat,
  Divider,
  Skeleton,
  List,
  ListItem,
  Tabs,
  SegmentedControl,
  Modal,
  Stack,
  Inline,
  Grid,
} as const;

export type UiKit = typeof ui;
