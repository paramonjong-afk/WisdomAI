import { alpha, createTheme } from '@mui/material'

export const uiResponsiveConfig = {
  mobileMaxWidth: 600,
  tabletMaxWidth: 900,
  largeDesktopMinWidth: 1280,
}

export const appTheme=createTheme({
  breakpoints: {
    values: {
      xs: 0,
      sm: 600,
      md: 900,
      lg: 1200,
      xl: 1536,
    },
  },
  palette:{
    primary:{main:'#A65940',dark:'#71392C',light:'#FABFB2',contrastText:'#FFFFFF'},
    secondary:{main:'#333333',contrastText:'#FFFFFF'},
    background:{default:'#F8F6F5',paper:'#FFFFFF'},
    text:{primary:'#333333',secondary:'#6F6966'},
    divider:'#E5DFDC',
    success:{main:'#2E7D4F'},warning:{main:'#B86A16'},error:{main:'#C43D3D'},info:{main:'#3973A8'},
    action:{hover:alpha('#A65940',.07),selected:alpha('#A65940',.13),disabledBackground:'#E8E5E3'},
  },
  shape:{borderRadius:12},
  typography:{
    fontFamily:'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    h4:{fontWeight:800,fontSize:'clamp(1.65rem, 2.3vw, 2.15rem)',letterSpacing:'-.025em'},
    h6:{fontWeight:750,letterSpacing:'-.01em'},
    button:{fontWeight:700,textTransform:'none'},
  },
  components:{
    MuiCssBaseline:{
      styleOverrides:{
        body:{backgroundColor:'#F8F6F5'},
        '*':{boxSizing:'border-box'},
        'html, body':{maxWidth:'100%',overflowX:'hidden'},
        '::selection':{backgroundColor:alpha('#A65940',0.24),color:'#1F140F'},
        '@media (max-width: 600px)': {
          'body':{fontSize:'0.94rem',lineHeight:1.4},
          'h1,h2,h3,h4,h5,h6':{lineHeight:1.2},
          '.MuiTypography-h4':{fontSize:'1.35rem'},
          '.MuiTypography-h5':{fontSize:'1.15rem'},
          '.MuiButton-root':{minHeight:36},
        },
      },
    },
    MuiPaper:{styleOverrides:{root:{backgroundImage:'none'},outlined:{borderColor:'#E5DFDC'}}},
    MuiButton:{defaultProps:{disableElevation:true},styleOverrides:{root:{minHeight:40,borderRadius:10,'@media (max-width: 600px)':{minHeight:36}}}},
    MuiTextField:{defaultProps:{variant:'outlined'}},
    MuiOutlinedInput:{styleOverrides:{root:{borderRadius:10,backgroundColor:'#FFFFFF'}}},
    MuiTabs:{defaultProps:{scrollButtons:'auto',allowScrollButtonsMobile:true},styleOverrides:{root:{minHeight:44},indicator:{height:3,borderRadius:'3px 3px 0 0'}}},
    MuiTab:{styleOverrides:{root:{minHeight:44,fontWeight:700,'@media (max-width: 600px)':{minWidth:110,minHeight:40,fontSize:'0.84rem'}}}},
    MuiTableContainer:{styleOverrides:{root:{overflowX:'auto'}}},
    MuiTableHead:{styleOverrides:{root:{backgroundColor:'#F4F0EE'}}},
    MuiTableCell:{styleOverrides:{head:{fontWeight:800,color:'#333333'},root:{borderColor:'#ECE7E4'}}},
    MuiAlert:{styleOverrides:{root:{borderRadius:10}}},
  },
})
