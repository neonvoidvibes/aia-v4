import * as React from "react"

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const checkTouchDevice = () => {
      setIsMobile(navigator.maxTouchPoints > 0)
    }
    
    // Initial check
    checkTouchDevice()
  }, [])

  return !!isMobile
}
