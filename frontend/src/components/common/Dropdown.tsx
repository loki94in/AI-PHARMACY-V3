import React, { useState, useRef, useCallback } from 'react';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';

export interface DropdownRenderProps {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export interface DropdownProps {
  /**
   * The trigger element (button, icon, etc.) or a render function receiving open/toggle state.
   */
  trigger: React.ReactNode | ((props: DropdownRenderProps) => React.ReactNode);

  /**
   * The contents of the dropdown menu. Can be React nodes or a render function providing a close callback.
   */
  children: React.ReactNode | ((props: { close: () => void }) => React.ReactNode);

  /**
   * Alignment relative to the trigger. Defaults to 'left'.
   */
  align?: 'left' | 'right' | 'center';

  /**
   * Placement relative to the trigger. Defaults to 'bottom'.
   */
  placement?: 'bottom' | 'top';

  /**
   * Controlled open state.
   */
  isOpen?: boolean;

  /**
   * Callback fired when open state changes.
   */
  onOpenChange?: (open: boolean) => void;

  /**
   * Custom CSS class name for the wrapper element.
   */
  className?: string;

  /**
   * Custom CSS class name for the dropdown menu panel.
   */
  menuClassName?: string;

  /**
   * Whether clicking outside auto-closes the dropdown. Defaults to true.
   */
  closeOnClickOutside?: boolean;

  /**
   * Whether pressing Escape auto-closes the dropdown. Defaults to true.
   */
  closeOnEscape?: boolean;
}

/**
 * Standard, accessible, and lightweight Dropdown component.
 * Automatically handles outside clicks, Escape key dismissals, alignment,
 * and semantic design tokens without requiring manual document listeners.
 */
export const Dropdown: React.FC<DropdownProps> = ({
  trigger,
  children,
  align = 'left',
  placement = 'bottom',
  isOpen: controlledIsOpen,
  onOpenChange,
  className = '',
  menuClassName = '',
  closeOnClickOutside = true,
  closeOnEscape = true,
}) => {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isControlled = controlledIsOpen !== undefined;
  const open = isControlled ? controlledIsOpen : internalIsOpen;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setInternalIsOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange]
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, [setOpen]);

  const handleToggle = useCallback(() => {
    setOpen(!open);
  }, [open, setOpen]);

  useOnClickOutside(
    containerRef,
    () => {
      if (open) {
        handleClose();
      }
    },
    { enabled: closeOnClickOutside, closeOnEscape }
  );

  const alignClass =
    align === 'right'
      ? 'right-0'
      : align === 'center'
      ? 'left-1/2 -translate-x-1/2'
      : 'left-0';

  const placementClass = placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5';

  const renderProps: DropdownRenderProps = {
    isOpen: open,
    open: handleOpen,
    close: handleClose,
    toggle: handleToggle,
  };

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {typeof trigger === 'function' ? (
        trigger(renderProps)
      ) : (
        <div onClick={handleToggle} className="inline-block cursor-pointer">
          {trigger}
        </div>
      )}

      {open && (
        <div
          role="menu"
          aria-orientation="vertical"
          className={`absolute ${placementClass} ${alignClass} z-dropdown bg-bg2 border border-border rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] overflow-hidden animate-in fade-in duration-150 ${menuClassName}`}
        >
          {typeof children === 'function' ? children({ close: handleClose }) : children}
        </div>
      )}
    </div>
  );
};
