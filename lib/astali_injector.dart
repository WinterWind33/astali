// Copyright (C) 2022 Andrea Ballestrazzi

import 'settings/settings_items_event_handler.dart';

/// Represents an injector class that provides objects instances for the correct
/// execution of the main astali app.
abstract class AstaliInjector {
  SettingsItemsEventHandler getSettingsItemsEventHandler();
}
