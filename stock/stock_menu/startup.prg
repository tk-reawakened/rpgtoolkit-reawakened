registerplugin({
    name: "stock_menu",
    commands: {
        internalmenu: (menu, next) => {
            return next(menu)
        }
    }
})
