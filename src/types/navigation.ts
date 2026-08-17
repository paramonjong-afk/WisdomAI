export interface NavigationItem {
  label: string
  path: string
  roles?: Array<'admin'|'manager'|'employee'>
  platformOnly?: boolean
}

export interface NavigationGroup {
  label:string
  items:NavigationItem[]
}
