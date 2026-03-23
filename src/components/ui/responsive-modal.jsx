"use client"

import * as React from "react"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { cn } from "@/lib/utils"

const ResponsiveModalContext = React.createContext(false)

function useResponsiveModalContext() {
  return React.useContext(ResponsiveModalContext)
}

function ResponsiveModal({ open, onOpenChange, children, ...props }) {
  const isMobile = useIsMobile()
  const Root = isMobile ? Drawer : Dialog

  // Mobile modal conventions:
  // - use stacked actions and full-width primary buttons
  // - collapse multi-column forms below 768px
  // - keep sticky actions inside the modal instead of relying on viewport height
  return (
    <ResponsiveModalContext.Provider value={isMobile}>
      <Root open={open} onOpenChange={onOpenChange} handleOnly={isMobile ? true : undefined} {...props}>
        {children}
      </Root>
    </ResponsiveModalContext.Provider>
  )
}

const ResponsiveModalContent = React.forwardRef(
  ({ className, mobileClassName, ...props }, ref) => {
    const isMobile = useResponsiveModalContext()
    const Content = isMobile ? DrawerContent : DialogContent

    return (
      <Content
        ref={ref}
        className={cn(
          isMobile
            ? "max-h-[90vh] overflow-y-auto rounded-t-2xl border-border bg-background px-0 pb-[max(env(safe-area-inset-bottom),1rem)]"
            : "",
          className,
          isMobile && mobileClassName
        )}
        {...props}
      />
    )
  }
)
ResponsiveModalContent.displayName = "ResponsiveModalContent"

function ResponsiveModalHeader({ className, ...props }) {
  const isMobile = useResponsiveModalContext()
  const Header = isMobile ? DrawerHeader : DialogHeader

  return <Header className={cn(isMobile ? "px-4 pb-2" : "", className)} {...props} />
}

const ResponsiveModalTitle = React.forwardRef(({ className, ...props }, ref) => {
  const isMobile = useResponsiveModalContext()
  const Title = isMobile ? DrawerTitle : DialogTitle

  return <Title ref={ref} className={cn(isMobile ? "text-left" : "", className)} {...props} />
})
ResponsiveModalTitle.displayName = "ResponsiveModalTitle"

const ResponsiveModalDescription = React.forwardRef(({ className, ...props }, ref) => {
  const isMobile = useResponsiveModalContext()
  const Description = isMobile ? DrawerDescription : DialogDescription

  return <Description ref={ref} className={cn(isMobile ? "text-left" : "", className)} {...props} />
})
ResponsiveModalDescription.displayName = "ResponsiveModalDescription"

function ResponsiveModalFooter({ className, ...props }) {
  const isMobile = useResponsiveModalContext()
  const Footer = isMobile ? DrawerFooter : DialogFooter

  return <Footer className={cn(isMobile ? "px-4 pb-0" : "", className)} {...props} />
}

function MobileStickyActions({ className, ...props }) {
  return (
    <div
      className={cn(
        "sticky bottom-0 -mx-4 border-t border-border/40 bg-background/95 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-2 sm:pb-0",
        className
      )}
      {...props}
    />
  )
}

export {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  MobileStickyActions,
  useResponsiveModalContext,
}
