# Parameter Execute DAT callbacks for the Liquid Glass Lit component.
# Watches the component's Preset menu, the 'Apply preset again' pulse and the
# 'Fit to Glass geometry' pulse. Choosing 'Custom' keeps the current values.

def onValueChange(par, prev):
    if par.name == 'Preset' and par.eval() != 'custom':
        op('presets').module.apply(par.owner, par.eval())
    return


def onPulse(par):
    if par.name == 'Applypreset':
        op('presets').module.apply(par.owner, par.owner.par.Preset.eval())
    elif par.name == 'Fitglass':
        print(op('study_tools').module.fit_glass(par.owner))
    return
