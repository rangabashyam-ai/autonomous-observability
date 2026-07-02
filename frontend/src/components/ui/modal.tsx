import { X } from 'lucide-react';
import RightDrawerShell, { RightDrawerBody, RightDrawerHeader } from '../drilldown/RightDrawerShell';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  return (
    <RightDrawerShell isOpen={isOpen} onClose={onClose} ariaLabel={title}>
      <RightDrawerHeader title={title} onClose={onClose} />
      <RightDrawerBody className="p-6">{children}</RightDrawerBody>
    </RightDrawerShell>
  );
}

/** @deprecated Use RightDrawerShell directly — kept for imports that expect Drawer */
export function Drawer({ isOpen, onClose, title, children }: ModalProps) {
  return <Modal isOpen={isOpen} onClose={onClose} title={title}>{children}</Modal>;
}

export { RightDrawerShell, RightDrawerBody, RightDrawerHeader };
