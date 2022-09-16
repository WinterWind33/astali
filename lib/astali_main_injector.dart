// Copyright (C) 2022 Andrea Ballestrazzi

import 'settings/settings_items_event_handler.dart';
import 'settings/settings_items_event_handler_impl.dart';

import 'astali_injector.dart';

/// Represents the injector used inside the astali entry point.
class AstaliMainInjector implements AstaliInjector {
  const AstaliMainInjector();

  @override
  SettingsItemsEventHandler getSettingsItemsEventHandler() {
    return const SettingsItemsEventHandlerImpl();
  }
}
